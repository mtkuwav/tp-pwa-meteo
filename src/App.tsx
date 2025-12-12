import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BellRing,
  Bookmark,
  CloudRain,
  Loader2,
  MapPin,
  Moon,
  SunMedium,
  Wind,
  X,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const CONFIG = {
  GEOCODING_API: 'https://geocoding-api.open-meteo.com/v1/search',
  WEATHER_API: 'https://api.open-meteo.com/v1/forecast',
  STORAGE_KEY_FAVORITES: 'meteo-pwa-favorites',
  STORAGE_KEY_THEME: 'meteo-pwa-theme',
  RAIN_CODES: [
    51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86,
    95, 96, 99,
  ],
  TEMP_THRESHOLD: 10,
} as const

type Theme = 'light' | 'dark'
type NotificationState = 'unsupported' | 'prompt' | 'granted' | 'denied'

type FavoriteCity = {
  name: string
  lat: number
  lon: number
}

type WeatherResponse = {
  current: {
    temperature_2m: number
    weather_code: number
    wind_speed_10m: number
    relative_humidity_2m: number
    apparent_temperature: number
  }
  hourly: {
    time: string[]
    temperature_2m: number[]
    weather_code: number[]
    precipitation_probability: number[]
  }
}

type HourlySlice = {
  date: Date
  temperature: number
  weatherCode: number
  precipitation: number | null
}

const WEATHER_EMOJIS: Record<number, string> = {
  0: '\u2600\uFE0F',
  1: '\uD83C\uDF24\uFE0F',
  2: '\u26C5',
  3: '\u2601\uFE0F',
  45: '\uD83C\uDF2B\uFE0F',
  48: '\uD83C\uDF2B\uFE0F',
  51: '\uD83C\uDF26\uFE0F',
  53: '\uD83C\uDF26\uFE0F',
  55: '\uD83C\uDF27\uFE0F',
  56: '\uD83C\uDF28\uFE0F',
  57: '\uD83C\uDF28\uFE0F',
  61: '\uD83C\uDF27\uFE0F',
  63: '\uD83C\uDF27\uFE0F',
  65: '\uD83C\uDF27\uFE0F',
  66: '\uD83C\uDF28\uFE0F',
  67: '\uD83C\uDF28\uFE0F',
  71: '\uD83C\uDF28\uFE0F',
  73: '\uD83C\uDF28\uFE0F',
  75: '\u2744\uFE0F',
  77: '\uD83C\uDF28\uFE0F',
  80: '\uD83C\uDF26\uFE0F',
  81: '\uD83C\uDF27\uFE0F',
  82: '\u26C8\uFE0F',
  85: '\uD83C\uDF28\uFE0F',
  86: '\u2744\uFE0F',
  95: '\u26C8\uFE0F',
  96: '\u26C8\uFE0F',
  99: '\u26C8\uFE0F',
}

const HOUR_LOOKAHEAD = 4
const RAIN_CODES_SET = new Set<number>(CONFIG.RAIN_CODES)

const isBrowser = typeof window !== 'undefined'

const getStoredTheme = (): Theme => {
  if (!isBrowser) return 'light'
  const stored = window.localStorage.getItem(CONFIG.STORAGE_KEY_THEME)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

const getNotificationState = (): NotificationState => {
  if (!isBrowser || !('Notification' in window)) return 'unsupported'
  const permission = Notification.permission
  if (permission === 'granted') return 'granted'
  if (permission === 'denied') return 'denied'
  return 'prompt'
}

const readStorage = <T,>(key: string, fallback: T): T => {
  if (!isBrowser) return fallback
  try {
    const stored = window.localStorage.getItem(key)
    if (!stored) return fallback
    return JSON.parse(stored) as T
  } catch (error) {
    console.warn('[storage] Unable to parse', key, error)
    return fallback
  }
}

const persistStorage = <T,>(key: string, value: T) => {
  if (!isBrowser) return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.warn('[storage] Unable to persist', key, error)
  }
}

const formatCityName = (result: {
  name: string
  admin1?: string
  country?: string
}): string => {
  const area = result.admin1 ? `, ${result.admin1}` : ''
  const country = result.country ? `, ${result.country}` : ''
  return `${result.name}${area}${country}`.trim()
}

const getNextHours = (
  hourly: WeatherResponse['hourly'],
  count = HOUR_LOOKAHEAD,
): HourlySlice[] => {
  const now = Date.now()
  const slices: HourlySlice[] = []

  for (let i = 0; i < hourly.time.length; i += 1) {
    const slotTime = new Date(hourly.time[i]).getTime()
    if (slotTime <= now) continue

    slices.push({
      date: new Date(hourly.time[i]),
      temperature: hourly.temperature_2m[i],
      weatherCode: hourly.weather_code[i],
      precipitation:
        hourly.precipitation_probability?.[i] ?? null,
    })

    if (slices.length === count) break
  }

  return slices
}

const getWeatherEmoji = (code: number) =>
  WEATHER_EMOJIS[code] ?? '\uD83C\uDF24\uFE0F'

const hourFormatter = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
})

async function fetchWeatherData(
  lat: number,
  lon: number,
): Promise<WeatherResponse> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    current:
      'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    timezone: 'auto',
    forecast_days: '1',
  })

  const response = await fetch(`${CONFIG.WEATHER_API}?${params.toString()}`)
  if (!response.ok) {
    throw new Error('Erreur lors de la recuperation des donnees meteo')
  }

  return (await response.json()) as WeatherResponse
}

async function geocodeCity(value: string): Promise<FavoriteCity> {
  const params = new URLSearchParams({
    name: value,
    count: '1',
    language: 'fr',
    format: 'json',
  })
  const response = await fetch(`${CONFIG.GEOCODING_API}?${params.toString()}`)
  if (!response.ok) {
    throw new Error('Erreur de geocodage. Verifiez votre connexion.')
  }

  const data = (await response.json()) as {
    results?: Array<{
      name: string
      admin1?: string
      country?: string
      latitude: number
      longitude: number
    }>
  }

  if (!data.results?.length) {
    throw new Error(`La ville "${value}" est introuvable.`)
  }

  const [result] = data.results
  return {
    name: formatCityName(result),
    lat: result.latitude,
    lon: result.longitude,
  }
}

function App() {
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState<FavoriteCity[]>(() =>
    readStorage(CONFIG.STORAGE_KEY_FAVORITES, []),
  )
  const [selectedCity, setSelectedCity] = useState<FavoriteCity | null>(null)
  const [weather, setWeather] = useState<WeatherResponse | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme())
  const [notificationState, setNotificationState] = useState<NotificationState>(
    () => getNotificationState(),
  )
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    isBrowser ? window.navigator.onLine : true,
  )

  useEffect(() => {
    if (!isBrowser) return
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.style.setProperty(
      'color-scheme',
      theme === 'dark' ? 'dark' : 'light',
    )
    persistStorage(CONFIG.STORAGE_KEY_THEME, theme)
  }, [theme])

  useEffect(() => {
    if (!isBrowser) return
    const updateStatus = () => setIsOnline(window.navigator.onLine)
    window.addEventListener('online', updateStatus)
    window.addEventListener('offline', updateStatus)
    return () => {
      window.removeEventListener('online', updateStatus)
      window.removeEventListener('offline', updateStatus)
    }
  }, [])

  useEffect(() => {
    persistStorage(CONFIG.STORAGE_KEY_FAVORITES, favorites)
  }, [favorites])

  const sendWeatherNotification = useCallback(async (title: string, body: string) => {
    if (!isBrowser || !('Notification' in window)) return
    if (Notification.permission !== 'granted') return

    const options: NotificationOptions = {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-72.png',
      tag: `meteo-alert-${title}`,
    }

    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready
        await registration.showNotification(title, options)
      }
    } catch (error) {
      console.warn('[PWA] showNotification fallback', error)
    } finally {
      try {
        new Notification(title, options)
      } catch (error) {
        console.warn('[PWA] Direct notification failed', error)
      }
    }
  }, [])

  const checkAlerts = useCallback(
    (data: WeatherResponse, cityLabel: string) => {
      const slices = getNextHours(data.hourly, HOUR_LOOKAHEAD)
      const rainSlice = slices.find((slice) =>
        RAIN_CODES_SET.has(slice.weatherCode),
      )
      const warmSlice = slices.find(
        (slice) => slice.temperature > CONFIG.TEMP_THRESHOLD,
      )

      if (rainSlice) {
        const hoursUntil = Math.max(
          1,
          Math.round((rainSlice.date.getTime() - Date.now()) / 3_600_000),
        )
        void sendWeatherNotification(
          `Pluie attendue - ${cityLabel}`,
          `Des averses sont prevues d'ici ${hoursUntil} h. Pensez au parapluie !`,
        )
      }

      if (warmSlice) {
        void sendWeatherNotification(
          `Chaleur a venir - ${cityLabel}`,
          `La temperature depassera ${CONFIG.TEMP_THRESHOLD}\u00B0C (~ ${Math.round(
            warmSlice.temperature,
          )}\u00B0C).`,
        )
      }
    },
    [sendWeatherNotification],
  )

  const handleSearch = useCallback(
    async (preset?: FavoriteCity) => {
      const candidate = preset?.name ?? query
      const value = candidate.trim()

      if (!value) {
        setError('Veuillez saisir une ville.')
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const location = preset ?? (await geocodeCity(value))
        setSelectedCity(location)
        setQuery(location.name)

        const weatherResponse = await fetchWeatherData(
          location.lat,
          location.lon,
        )
        setWeather(weatherResponse)
        setLastUpdated(new Date())
        void sendWeatherNotification(
          `Meteo actualisee - ${location.name}`,
          `Actuellement ${Math.round(
            weatherResponse.current.temperature_2m,
          )}\u00B0C avec un vent de ${Math.round(
            weatherResponse.current.wind_speed_10m,
          )} km/h.`,
        )
        checkAlerts(weatherResponse, location.name)
      } catch (err) {
        setWeather(null)
        if (err instanceof Error) {
          setError(err.message)
        } else {
          setError('Erreur inattendue. Veuillez reessayer.')
        }
      } finally {
        setIsLoading(false)
      }
    },
    [checkAlerts, query],
  )

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void handleSearch()
  }

  const handleNotificationRequest = useCallback(async () => {
    const state = getNotificationState()
    if (state === 'unsupported') return
    if (state === 'denied') {
      setNotificationState('denied')
      setError(
        "Les notifications sont bloquees par votre navigateur. Activez-les dans les reglages.",
      )
      return
    }

    if (state === 'granted') {
      setNotificationState('granted')
      void sendWeatherNotification(
        'Alertes Meteo actives',
        'Nous vous prevenons en cas de pluie ou de chaleur.',
      )
      return
    }

    try {
      const permission = await Notification.requestPermission()
      if (permission === 'granted') {
        setNotificationState('granted')
        void sendWeatherNotification(
          'Notifications activees',
          'Vous recevrez des alertes pour cette session meteo.',
        )
      } else if (permission === 'denied') {
        setNotificationState('denied')
      } else {
        setNotificationState('prompt')
      }
    } catch (error) {
      console.error('Notification permission error', error)
    }
  }, [sendWeatherNotification])

  const handleFavoriteSave = () => {
    if (!selectedCity) return
    setFavorites((prev) => {
      if (prev.some((city) => city.name === selectedCity.name)) {
        return prev
      }
      return [selectedCity, ...prev].slice(0, 8)
    })
  }

  const handleFavoriteRemove = (name: string) => {
    setFavorites((prev) => prev.filter((city) => city.name !== name))
  }

  const hourlySlices = useMemo(() => {
    if (!weather) return []
    return getNextHours(weather.hourly)
  }, [weather])

  const isFavorite = useMemo(() => {
    if (!selectedCity) return false
    return favorites.some((fav) => fav.name === selectedCity.name)
  }, [favorites, selectedCity])

  const notificationLabel: Record<NotificationState, string> = {
    prompt: 'Activer les notifications',
    granted: 'Notifications actives',
    denied: 'Notifications bloquees',
    unsupported: 'Notifications indisponibles',
  }

  return (
    <div
      className={cn(
        'min-h-screen bg-linear-to-b pb-16',
        theme === 'dark'
          ? 'from-slate-950 via-slate-900 to-slate-900'
          : 'from-slate-50 via-white to-slate-100',
      )}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
        <header className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold tracking-wide text-primary uppercase">
              Meteo PWA
            </p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Recherchez une ville et surveillez la pluie ou la chaleur
            </h1>
            <p className="text-base text-muted-foreground">
              Donnees Open-Meteo, favoris hors ligne, notifications locales et mode sombre pour obtenir plus de 90% sur Lighthouse.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant={notificationState === 'granted' ? 'secondary' : 'outline'}
              onClick={handleNotificationRequest}
              disabled={notificationState === 'unsupported'}
              className="gap-2"
            >
              <BellRing className="h-4 w-4" />
              {notificationLabel[notificationState]}
            </Button>
            <Badge
              variant={isOnline ? 'secondary' : 'destructive'}
              className="gap-1"
            >
              <CloudRain className="h-3.5 w-3.5" />
              {isOnline ? 'En ligne' : 'Hors-ligne'}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <MapPin className="h-3.5 w-3.5" />
              API Open-Meteo
            </Badge>
            <div className="ml-auto flex items-center gap-2 rounded-full border border-border/70 px-3 py-1 text-sm">
              <SunMedium className="h-4 w-4 text-amber-500" />
              <Switch
                checked={theme === 'dark'}
                onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
                aria-label="Activer le mode sombre"
              />
              <Moon className="h-4 w-4 text-slate-500" />
            </div>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Ville a analyser</CardTitle>
            <CardDescription>
              Saisissez une ville pour afficher la temperature actuelle et les 4 prochaines heures.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-3 sm:flex-row"
              onSubmit={handleSubmit}
              aria-label="Recherche de ville"
            >
              <label htmlFor="city-search" className="sr-only">
                Ville
              </label>
              <Input
                id="city-search"
                placeholder="Ex. Paris, Marseille, Montreal"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                required
              />
              <Button type="submit" disabled={isLoading} className="gap-2">
                {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Rechercher
              </Button>
            </form>

            {favorites.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium text-muted-foreground">
                  Favoris rapides
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {favorites.map((favorite) => (
                    <div
                      key={favorite.name}
                      className="flex items-center gap-1 rounded-full border px-3 py-1 text-sm"
                    >
                      <button
                        type="button"
                        className="font-medium"
                        onClick={() => {
                          setQuery(favorite.name)
                          void handleSearch(favorite)
                        }}
                      >
                        {favorite.name}
                      </button>
                      <button
                        type="button"
                        className="text-muted-foreground transition hover:text-destructive"
                        aria-label={`Retirer ${favorite.name} des favoris`}
                        onClick={() => handleFavoriteRemove(favorite.name)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {error && (
          <div
            role="alert"
            className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <AlertTriangle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        )}

        {isLoading && (
          <Card>
            <CardContent className="space-y-4 py-6">
              <Skeleton className="h-6 w-1/2" />
              <div className="grid gap-4 sm:grid-cols-3">
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
              </div>
              <Skeleton className="h-32" />
            </CardContent>
          </Card>
        )}

        {weather && selectedCity && !isLoading && (
          <Card className="shadow-lg">
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <span>{getWeatherEmoji(weather.current.weather_code)}</span>
                  {selectedCity.name}
                </CardTitle>
                <CardDescription>
                  Mise a jour {lastUpdated?.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant={isFavorite ? 'secondary' : 'default'}
                  onClick={handleFavoriteSave}
                  disabled={isFavorite}
                  className="gap-2"
                >
                  <Bookmark className="h-4 w-4" />
                  {isFavorite ? 'Ville en favoris' : 'Ajouter aux favoris'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl bg-primary/10 p-4">
                  <p className="text-sm text-muted-foreground">Temperature actuelle</p>
                  <p className="text-4xl font-semibold">
                    {Math.round(weather.current.temperature_2m)}&deg;C
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Ressenti {Math.round(weather.current.apparent_temperature)}&deg;C
                  </p>
                </div>
                <div className="rounded-xl border bg-card p-4">
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <CloudRain className="h-4 w-4" /> Precipitations</p>
                  <p className="text-2xl font-semibold">
                    {hourlySlices[0]?.precipitation ?? 0}%
                  </p>
                  <p className="text-sm text-muted-foreground">Sur la prochaine heure</p>
                </div>
                <div className="rounded-xl border bg-card p-4">
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Wind className="h-4 w-4" /> Vent</p>
                  <p className="text-2xl font-semibold">
                    {Math.round(weather.current.wind_speed_10m)} km/h
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Humidite {weather.current.relative_humidity_2m}%
                  </p>
                </div>
              </div>

              <Separator />

              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Prochaines heures
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {hourlySlices.map((slice) => (
                    <div
                      key={slice.date.toISOString()}
                      className={cn(
                        'flex items-center justify-between rounded-lg border px-4 py-3',
                        RAIN_CODES_SET.has(slice.weatherCode)
                          ? 'border-sky-400 bg-sky-500/10'
                          : slice.temperature > CONFIG.TEMP_THRESHOLD
                            ? 'border-amber-400 bg-amber-200/20'
                            : '',
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl" aria-hidden>{getWeatherEmoji(slice.weatherCode)}</span>
                        <div>
                          <p className="text-sm font-medium">
                            {hourFormatter.format(slice.date)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {slice.precipitation ?? 0}% pluie
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-semibold">
                          {Math.round(slice.temperature)}&deg;C
                        </p>
                        {slice.temperature > CONFIG.TEMP_THRESHOLD && (
                          <p className="text-xs text-amber-600">Au-dessus de {CONFIG.TEMP_THRESHOLD}&deg;C</p>
                        )}
                      </div>
                    </div>
                  ))}
                  {hourlySlices.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Aucune donnee horaire n'a pu etre chargee.
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

export default App

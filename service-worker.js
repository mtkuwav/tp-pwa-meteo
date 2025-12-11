// ===== CONFIGURATION =====
// Modifier ces valeurs pour votre application
const CACHE_NAME = 'meteo-pwa-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/manifest.json',
    '/icons/icon-72.png',
    '/icons/icon-96.png',
    '/icons/icon-128.png',
    '/icons/icon-144.png',
    '/icons/icon-152.png',
    '/icons/icon-192.png',
    '/icons/icon-384.png',
    '/icons/icon-512.png'
];

// ===== INSTALL =====
// Mise en cache initiale des fichiers statiques
self.addEventListener('install', (event) => {
    console.log('[SW] Installation...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Mise en cache des assets');
                return cache.addAll(ASSETS);
            })
            .then(() => {
                // Force l'activation immédiate du nouveau SW
                return self.skipWaiting();
            })
    );
});

// ===== ACTIVATE =====
// Nettoyage des anciens caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activation...');
    event.waitUntil(
        caches.keys()
            .then((keys) => {
                return Promise.all(
                    keys
                        .filter((key) => key !== CACHE_NAME)
                        .map((key) => {
                            console.log('[SW] Suppression ancien cache:', key);
                            return caches.delete(key);
                        })
                );
            })
            .then(() => {
                // Prend le contrôle de toutes les pages immédiatement
                return self.clients.claim();
            })
    );
});

// ===== FETCH =====
// Stratégie : Network First avec fallback sur le cache
// - Pour les API : tente le réseau, sinon erreur (pas de cache des données API)
// - Pour les assets : tente le réseau, sinon cache
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Ignorer les requêtes non-GET
    if (request.method !== 'GET') return;

    // Ignorer les extensions Chrome et autres protocoles
    if (!url.protocol.startsWith('http')) return;

    // Stratégie différente selon le type de ressource
    if (isApiRequest(url)) {
        // API : Network only (pas de cache pour les données météo)
        event.respondWith(networkOnly(request));
    } else {
        // Assets statiques : Cache First, Network Fallback
        event.respondWith(cacheFirst(request));
    }
});

// ===== Détection des requêtes API =====
function isApiRequest(url) {
    return url.hostname.includes('open-meteo.com') ||
           url.hostname.includes('geocoding-api');
}

// ===== Stratégie : Network Only =====
// Pour les API : on veut toujours des données fraîches
async function networkOnly(request) {
    try {
        const response = await fetch(request);
        return response;
    } catch (error) {
        console.log('[SW] Erreur réseau pour API:', error);
        // Retourner une erreur JSON pour que l'app puisse l'afficher
        return new Response(
            JSON.stringify({ error: 'Pas de connexion internet' }),
            {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}

// ===== Stratégie : Cache First =====
// Pour les assets statiques : cache d'abord, réseau en fallback
async function cacheFirst(request) {
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
        // Réponse trouvée dans le cache
        return cachedResponse;
    }

    try {
        // Pas dans le cache, on essaie le réseau
        const networkResponse = await fetch(request);
        
        // Si succès, on met en cache pour la prochaine fois
        if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.log('[SW] Erreur réseau pour asset:', request.url);
        
        // Si c'est une page HTML, retourner la page d'accueil en cache
        if (request.headers.get('accept')?.includes('text/html')) {
            const fallback = await caches.match('/index.html');
            if (fallback) return fallback;
        }
        
        // Sinon, erreur
        return new Response('Contenu non disponible hors-ligne', {
            status: 503,
            statusText: 'Service Unavailable'
        });
    }
}

// ===== Messages depuis l'application =====
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

console.log('[SW] Service Worker chargé');

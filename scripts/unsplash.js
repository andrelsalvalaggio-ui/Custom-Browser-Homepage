const PROXY_URL = 'https://wallpaper-proxy.andrelsalvalaggio.workers.dev/';
const CACHE_KEY = 'unsplash_next_wallpaper';

async function fetchFromProxy(query = 'nature') {
    try {
        const queryParam = Array.isArray(query) ? query.join(',') : (query || 'nature');
        // Timestamp no query param para forçar a Cloudflare a NUNCA entregar cache
        const response = await fetch(`${PROXY_URL}?query=${encodeURIComponent(queryParam)}&_t=${Date.now()}`);

        if (!response.ok) {
            throw new Error(`Erro Proxy: ${response.statusText}`);
        }

        const data = await response.json();

        const screenWidth = window.innerWidth || 1920;
        const separator = data.rawUrl && data.rawUrl.includes('?') ? '&' : '?';
        const highResUrl = `${data.rawUrl}${separator}auto=format&fit=crop&w=${screenWidth}&q=80`;
        const lowResUrl = data.smallUrl;

        return {
            id: data.id,
            highResUrl,
            lowResUrl,
            color: data.color,
            authorName: data.authorName,
            authorProfile: data.authorProfile,
            unsplashUrl: data.unsplashUrl || `https://unsplash.com/?utm_source=custom_homepage&utm_medium=referral`
        };

    } catch (error) {
        console.error("Falha ao carregar imagem do Unsplash:", error);
        return null;
    }
}

function preloadImage(url) {
    if (!url) return;
    const img = new Image();
    img.src = url;
}

function getRandomQuery(queryOrQueries = 'nature') {
    if (Array.isArray(queryOrQueries) && queryOrQueries.length > 0) {
        const randomIndex = Math.floor(Math.random() * queryOrQueries.length);
        return queryOrQueries[randomIndex] || 'nature';
    }
    if (typeof queryOrQueries === 'string' && queryOrQueries.trim()) {
        return queryOrQueries.trim();
    }
    return 'nature';
}

let isPrefetching = false;
async function prefetchNextWallpaper(queries = 'nature', currentId = null) {
    if (isPrefetching) return;
    isPrefetching = true;
    try {
        const query = getRandomQuery(queries);
        let nextWallpaper = await fetchFromProxy(query);

        // Se por coincidência o Unsplash devolver a mesma foto, tenta mais uma vez
        if (nextWallpaper && currentId && nextWallpaper.id === currentId) {
            const retry = await fetchFromProxy(query);
            if (retry) nextWallpaper = retry;
        }

        if (nextWallpaper) {
            localStorage.setItem(CACHE_KEY, JSON.stringify(nextWallpaper));
            // Já faz o pré-download dos bytes da imagem no disco do navegador
            preloadImage(nextWallpaper.highResUrl);
        }
    } catch (e) {
        console.warn("Erro ao buscar próxima imagem:", e);
    } finally {
        isPrefetching = false;
    }
}

export function clearUnsplashCache() {
    try {
        localStorage.removeItem(CACHE_KEY);
    } catch (e) {
        console.warn("Erro ao limpar cache local:", e);
    }
}

export async function getUnsplashWallpaper(queries = 'nature') {
    let cached = null;
    try {
        const stored = localStorage.getItem(CACHE_KEY);
        if (stored) {
            cached = JSON.parse(stored);
        }
    } catch (e) {
        console.warn("Erro ao ler cache local:", e);
    }

    // 1. Se já temos uma imagem em cache no localStorage (pré-carregada na aba anterior):
    if (cached && cached.highResUrl) {
        // Dispara em segundo plano a busca da PRÓXIMA imagem diferente para a próxima aba
        setTimeout(() => prefetchNextWallpaper(queries, cached.id), 200);
        return cached;
    }

    // 2. Se for o primeiro acesso e ainda não tiver cache:
    const query = getRandomQuery(queries);
    const current = await fetchFromProxy(query);
    if (current) {
        // Já engatilha e guarda a próxima no localStorage
        setTimeout(() => prefetchNextWallpaper(queries, current.id), 500);
    }
    return current;
}

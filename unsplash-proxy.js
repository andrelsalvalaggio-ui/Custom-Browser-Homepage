const FALLBACK_WALLPAPERS = [
  {
    id: "NLF6hTe4PAg",
    rawUrl: "https://images.unsplash.com/photo-1506744038136-46273834b3fb",
    smallUrl: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=400",
    color: "#262626",
    authorName: "Bailey Zindel",
    authorProfile: "https://unsplash.com/@baileyzindel?utm_source=custom_homepage&utm_medium=referral",
    unsplashUrl: "https://unsplash.com/?utm_source=custom_homepage&utm_medium=referral",
    theme: "nature"
  },
  {
    id: "eNoeWZkO7Zc",
    rawUrl: "https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86",
    smallUrl: "https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?w=400",
    color: "#0c0d14",
    authorName: "Alexander Andrews",
    authorProfile: "https://unsplash.com/@alex_andrews?utm_source=custom_homepage&utm_medium=referral",
    unsplashUrl: "https://unsplash.com/?utm_source=custom_homepage&utm_medium=referral",
    theme: "space"
  },
  {
    id: "Z0d96glXlTI",
    rawUrl: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab",
    smallUrl: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=400",
    color: "#d9d9d9",
    authorName: "Parrish Freeman",
    authorProfile: "https://unsplash.com/@parrish?utm_source=custom_homepage&utm_medium=referral",
    unsplashUrl: "https://unsplash.com/?utm_source=custom_homepage&utm_medium=referral",
    theme: "architecture"
  },
  {
    id: "U39FPHKfDu0",
    rawUrl: "https://images.unsplash.com/photo-1494548162494-384bba4ab999",
    smallUrl: "https://images.unsplash.com/photo-1494548162494-384bba4ab999?w=400",
    color: "#262626",
    authorName: "Kam Idris",
    authorProfile: "https://unsplash.com/@kamidris?utm_source=custom_homepage&utm_medium=referral",
    unsplashUrl: "https://unsplash.com/?utm_source=custom_homepage&utm_medium=referral",
    theme: "minimal"
  },
  {
    id: "a0x0H8Wq87Y",
    rawUrl: "https://images.unsplash.com/photo-1477959858617-67f30bc75b82",
    smallUrl: "https://images.unsplash.com/photo-1477959858617-67f30bc75b82?w=400",
    color: "#262626",
    authorName: "Robert Bye",
    authorProfile: "https://unsplash.com/@robertbye?utm_source=custom_homepage&utm_medium=referral",
    unsplashUrl: "https://unsplash.com/?utm_source=custom_homepage&utm_medium=referral",
    theme: "city"
  }
];

export default {
  async fetch(request, env, ctx) {
    // 1. Trata CORS para a extensão conseguir chamar o Worker
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 2. Lê a chave configurada no painel da Cloudflare
    const accessKey = env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
      return new Response(
        JSON.stringify({ error: "UNSPLASH_ACCESS_KEY não configurada no Worker." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(request.url);

    // 3. Suporta múltiplos temas (query=nature,space ou múltiplos params query/themes/topics)
    const rawThemes = [
      ...url.searchParams.getAll("query"),
      ...url.searchParams.getAll("themes"),
      ...url.searchParams.getAll("topics")
    ];

    let themes = [];
    for (const item of rawThemes) {
      themes.push(...item.split(",").map(t => t.trim()).filter(Boolean));
    }

    if (themes.length === 0) {
      themes = ["nature"];
    }

    // Sorteia aleatoriamente um dos temas fornecidos
    const selectedTheme = themes[Math.floor(Math.random() * themes.length)];

    const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
    const cacheKey = new Request(`https://unsplash-cache.internal/${encodeURIComponent(selectedTheme)}`);

    try {
      // 4. Busca foto aleatória do Unsplash com filtro de segurança
      let response = await fetch(
        `https://api.unsplash.com/photos/random?orientation=landscape&content_filter=high&query=${encodeURIComponent(selectedTheme)}&_t=${Date.now()}`,
        {
          headers: {
            "Authorization": `Client-ID ${accessKey}`,
            "Accept-Version": "v1",
          },
          cf: {
            cacheTtl: 0,
            cacheEverything: false
          }
        }
      );

      // Se o tema pesquisado não encontrar fotos (404), tenta com fallback padrão 'nature'
      if (response.status === 404 && selectedTheme !== "nature") {
        response = await fetch(
          `https://api.unsplash.com/photos/random?orientation=landscape&content_filter=high&query=nature&_t=${Date.now()}`,
          {
            headers: {
              "Authorization": `Client-ID ${accessKey}`,
              "Accept-Version": "v1",
            },
            cf: {
              cacheTtl: 0,
              cacheEverything: false
            }
          }
        );
      }

      // Se atingir o limite de requisições da Unsplash (403/429) ou erro na API
      if (!response.ok) {
        console.warn(`Unsplash API retornou status ${response.status}: ${response.statusText}`);

        // Tenta recuperar do cache local do Cloudflare
        if (cache) {
          const cached = await cache.match(cacheKey) || await cache.match(new Request("https://unsplash-cache.internal/nature"));
          if (cached) {
            const cachedData = await cached.json();
            return new Response(JSON.stringify(cachedData), {
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
                "X-Proxy-Cache": "HIT"
              }
            });
          }
        }

        // Caso não haja cache, retorna wallpaper de fallback com atribuição
        const fallback = FALLBACK_WALLPAPERS.find(f => f.theme === selectedTheme) ||
                         FALLBACK_WALLPAPERS[Math.floor(Math.random() * FALLBACK_WALLPAPERS.length)];

        return new Response(JSON.stringify(fallback), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "X-Proxy-Fallback": "TRUE"
          }
        });
      }

      const data = await response.json();

      // 5. Contabiliza o download nos termos do Unsplash em segundo plano
      if (data.links?.download_location) {
        const downloadUrl = data.links.download_location;
        const trackingPromise = fetch(downloadUrl, {
          headers: {
            "Authorization": `Client-ID ${accessKey}`,
            "Accept-Version": "v1"
          }
        }).catch(e => console.warn("Erro ao contabilizar download Unsplash:", e));

        if (ctx && typeof ctx.waitUntil === 'function') {
          ctx.waitUntil(trackingPromise);
        }
      }

      // 6. Retorna os dados com o ID da imagem e UTMs de atribuição oficial
      const appUtm = "custom_homepage";
      const result = {
        id: data.id,
        rawUrl: data.urls.raw,
        smallUrl: data.urls.small,
        color: data.color,
        authorName: data.user.name,
        authorProfile: `${data.user.links.html}?utm_source=${appUtm}&utm_medium=referral`,
        unsplashUrl: `https://unsplash.com/?utm_source=${appUtm}&utm_medium=referral`,
        theme: selectedTheme
      };

      // Salva no cache do Cloudflare para servir caso o Unsplash atinja o rate limit futuramente
      if (cache && ctx && typeof ctx.waitUntil === 'function') {
        const responseToCache = new Response(JSON.stringify(result), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "max-age=86400"
          }
        });
        ctx.waitUntil(cache.put(cacheKey, responseToCache));
      }

      // 7. Cabeçalhos para evitar cache intermediário indesejado no cliente
      return new Response(JSON.stringify(result), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          "Pragma": "no-cache",
          "Expires": "0"
        },
      });

    } catch (err) {
      if (cache) {
        const cached = await cache.match(cacheKey) || await cache.match(new Request("https://unsplash-cache.internal/nature"));
        if (cached) {
          const cachedData = await cached.json();
          return new Response(JSON.stringify(cachedData), {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "X-Proxy-Cache": "HIT"
            }
          });
        }
      }

      const fallback = FALLBACK_WALLPAPERS[Math.floor(Math.random() * FALLBACK_WALLPAPERS.length)];
      return new Response(JSON.stringify(fallback), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "X-Proxy-Fallback": "TRUE"
        }
      });
    }
  },
};

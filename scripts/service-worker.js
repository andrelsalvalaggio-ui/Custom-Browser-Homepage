chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // This code runs ONLY when the extension is first installed
    console.log('Extension installed for the first time!');
    initialize(true);
  } else if (details.reason === 'update') {
    // Optional: Run this when you push an update (e.g., migration scripts)
    console.log('Extension updated to version ' + chrome.runtime.getManifest().version);
    initialize(false);
  }
});

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function initialize(isInstall = false) {
  // Migrar dados do local storage para o sync storage se existirem
  try {
    const localResult = await chrome.storage.local.get(['links']);
    if (localResult.links && localResult.links.length > 0) {
      console.log('Dados encontrados no local. Migrando para sync...');
      await chrome.storage.sync.set({
        links: localResult.links,
        showTutorial: false,
        defaultBGs: true,
        linkSize: 15
      });
      await chrome.storage.local.remove('links');
      console.log('Dados originais do local storage foram migrados e excluídos.');
    }
  } catch (e) {
    console.error('Erro na migração de dados:', e);
  }

  try {
    const syncResult = await chrome.storage.sync.get(['links']);
    if (!syncResult.links || syncResult.links.length === 0) {
      if (isInstall) {
        const defaultLinks = [
          {
            id: generateId(),
            name: 'Google',
            url: 'https://google.com',
            customIcon: null
          },
          {
            id: generateId(),
            name: 'Youtube',
            url: 'https://youtube.com',
            customIcon: null
          }
        ];

        await chrome.storage.sync.set({ 
          links: defaultLinks,
          showTutorial: true,
          defaultBGs: true,
          linkSize: 15
        });
        console.log('Default data saved.');
        try {
          chrome.tabs.create({
            url: 'chrome://newtab'
          });
        } catch (err) {
          chrome.tabs.create({
            url: chrome.runtime.getURL('homepage.html')
          });
        }
      }
    } else {
      console.log('Sync storage is NOT empty.');
    }
  } catch (e) {
    console.error('Erro ao inicializar sync storage:', e);
  }
}

function clearAllSyncData() {
    chrome.storage.sync.clear(() => {
        if (chrome.runtime.lastError) {
            console.error("Error clearing data:", chrome.runtime.lastError);
        } else {
            console.log("All sync data cleared successfully.");
            chrome.runtime.reload(); 
        }
    });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

    if (msg.action === "fetchFavicon") {
        if (!msg.hostname) {
            sendResponse(null);
            return;
        }

        const cleanHostname = msg.hostname.trim().toLowerCase();

        (async () => {
            try {
                // Icon Horse API: obtém o melhor favicon disponível para o domínio (PNG/ICO em alta qualidade)
                const iconHorseUrl = `https://icon.horse/icon/${encodeURIComponent(cleanHostname)}`;
                
                let imgRes = null;
                try {
                    imgRes = await fetch(iconHorseUrl);
                } catch (e) {
                    console.warn(`Icon Horse inacessível para ${cleanHostname}, tentando Google S2...`);
                }
                
                // Fallback no Google S2 caso o Icon Horse falhe ou não retorne ok
                if (!imgRes || !imgRes.ok) {
                    try {
                        imgRes = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(cleanHostname)}&sz=128`);
                    } catch (e) {
                        console.warn(`Google S2 falhou para ${cleanHostname}:`, e);
                    }
                }

                if (!imgRes || !imgRes.ok) {
                    throw new Error(`Não foi possível obter o ícone para ${cleanHostname}`);
                }

                const buf = await imgRes.arrayBuffer();
                const bytes = new Uint8Array(buf);

                // Detecta o MIME type real para o data URI
                let contentType = (imgRes.headers.get("content-type") || "").split(';')[0].trim();
                if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
                    contentType = 'image/png';
                } else if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) {
                    contentType = 'image/x-icon';
                }

                if (!contentType || contentType === 'application/octet-stream') {
                    contentType = 'image/png';
                }

                let binary = '';
                const chunkSize = 8192;
                for (let i = 0; i < bytes.length; i += chunkSize) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
                }
                const base64 = btoa(binary);
                sendResponse(`data:${contentType};base64,${base64}`);
            } catch (err) {
                console.error("Favicon fetch failed for " + msg.hostname, err);
                sendResponse(null);
            }
        })();

        return true; // Mantém o canal aberto para o fetch assíncrono
    }

    if (msg.action === "updateIcon") {
        updateIcon(msg.isDark);
        sendResponse({ status: "recebido" }); 
    }
});

function updateIcon(isDark) {
    const iconVariant = isDark ? "-white" : "";

    chrome.action.setIcon({
        path: {
            16: `/icons/icon${iconVariant}-16.png`,
            32: `/icons/icon${iconVariant}-32.png`,
            48: `/icons/icon${iconVariant}-48.png`,
            96: `/icons/icon${iconVariant}-96.png`,
            128: `/icons/icon${iconVariant}-128.png`
        }
    }, () => {
        if (chrome.runtime.lastError) {
            console.error("X [Service Worker] Erro ao trocar o ícone", chrome.runtime.lastError.message);
        }
    });
}

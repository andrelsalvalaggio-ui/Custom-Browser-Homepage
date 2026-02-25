chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // This code runs ONLY when the extension is first installed
    console.log('Extension installed for the first time!');
    
    initialize();

  } else if (details.reason === 'update') {
    
    // Optional: Run this when you push an update (e.g., migration scripts)
    console.log('Extension updated to version ' + chrome.runtime.getManifest().version);

    initialize();
  }
});

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function initialize() {
  // This code runs ONLY when the extension is first installed
  
  const links = [
    {
      id: generateId(),
      name: 'Google',
      url: 'https://google.com',
      customIcon: null,
      row: 0,
      col: 0
    },
    {
      id: generateId(),
      name: 'Youtube',
      url: 'https://youtube.com',
      customIcon: null,
      row: 0,
      col: 1
    }
  ];


  // Migrar dados do local storage para o sync storage
  chrome.storage.local.get(['links'], (result) => {
    // Verifica se 'links' existe e tem conteúdo
    if (result.links && result.links.length > 0) {
        console.log('Dados encontrados no local. Migrando para sync...');
        console.log(result);

        // 1. Salva os dados no storage 'sync'
        chrome.storage.sync.set({
            links: result.links,
            showTutorial: false,
            defaultBGs: true,
            idArray: [],
            linkSize: 15
        }, () => {
            console.log('Dados armazenados com sucesso no sync.');

            // 2. APENAS APÓS salvar no sync, remove os dados do 'local'
            chrome.storage.local.remove('links', () => {
                console.log('Dados originais do local storage foram excluídos.');
            });
        });
    }
  });

  chrome.storage.sync.get(['links', 'idArray'], (result) =>{
      if (!result.links || result.links.length === 0) {
        chrome.storage.sync.set({ 
          links: links,
          showTutorial: true,
          defaultBGs: true,
          linkSize: 15
        }, () => {
          console.log('Default data saved.');
          chrome.tabs.create({
            url: 'chrome://newtab'
          });
        });
      } else {
          console.log('Sync storage is NOT empty.');
      }
  });
  
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
        const url = `https://favicons.seadfeng.workers.dev/${encodeURIComponent(msg.hostname)}.ico`;

        fetch(url)
            .then(r => r.arrayBuffer())
            .then(buf => {
                const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
                sendResponse(`data:image/x-icon;base64,${base64}`);
            })
            .catch(err => {
                console.error("Favicon fetch failed", err);
                sendResponse(null);
            });

        return true; // Mantém o canal aberto para o fetch assíncrono
    }

    if (msg.action === "updateIcon") {
        updateIcon(msg.isDark);
        sendResponse({ status: "recebido" }); 
        // Não precisa de 'return true' aqui porque updateIcon não é assíncrono
    }
});

function updateIcon(isDark) {
    const iconVariant = isDark ? "-white" : "";

    chrome.action.setIcon({
        path: {
            16: `../icons/icon${iconVariant}-16.png`,
            32: `../icons/icon${iconVariant}-32.png`,
            48: `../icons/icon${iconVariant}-48.png`,
            96: `../icons/icon${iconVariant}-96.png`,
            128: `../icons/icon${iconVariant}-128.png`
        }
    }, () => {
        if (chrome.runtime.lastError) {
            console.error("X [Service Worker] Erro ao trocar o ícone", chrome.runtime.lastError.message);
        }
    });
}
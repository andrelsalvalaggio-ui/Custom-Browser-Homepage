document.addEventListener('DOMContentLoaded', () => {

    if (!chrome?.storage?.sync) {
        console.error('Chrome storage API not available');
        return;
    }

    async function init() {
        setGridDefaults();
        loadPosition();
        loadFullWidth();
        const result = await chrome.storage.sync.get('defaultBGs');

        if (result.defaultBGs) {
            await resetBack();
            await chrome.storage.sync.set({ defaultBGs: false });
        } else {
            loadBackground();
        }

        await loadLinks();
        initSortable();
    }

    async function loadBackground() {
        const idArray = await getIdArray();
        console.log('idArray: ', idArray);
        if (idArray.length > 0) {
            console.log('Loading Customized Background.');

            const index = await getImageIndex(idArray.length);
            const backImg = await getBackground(idArray[index - 1]);

            document.body.style.backgroundImage = `url('${backImg}')`;
            loadImageDisplay(idArray);
        }
    }

    async function loadDefaultBackgrounds() {
        const totalDeImagens = 24;
        for (let i = 0; i < totalDeImagens; i++) {
            await addBackground(`img/${i}.jpg`);
        }
    }

    async function addBackground(imageSource) {
        const result = await chrome.storage.local.get(['idArray']);
        let idArrayB = result.idArray || [];

        const id = 'bg_' + idArrayB.length;
        idArrayB.push(id);

        await chrome.storage.local.set({ idArray: idArrayB });
        await chrome.storage.local.set({ [id]: imageSource });

        addDisplayImage(id);
        console.log("New background:", id);
        return id;
    }

    async function getBackground(id) {
        return new Promise(resolve => {
            chrome.storage.local.get([id], (result) => {
                const valor = result[id];
                resolve(valor);
            });
        });
    }

    async function getImageIndex(imagesLength) {
        const { lastImageIndex = 0 } = await chrome.storage.sync.get('lastImageIndex');
        let proximoIndice = lastImageIndex + 1;
        if (proximoIndice > imagesLength) proximoIndice = 1;

        await chrome.storage.sync.set({ lastImageIndex: proximoIndice });
        return proximoIndice;
    }

    // ELEMENTOS
    const closeOverlayBtn = document.getElementById('close-overlay-btn');
    const overlay = document.getElementById('add-link-overlay');
    const form = document.getElementById('add-link-form');
    const addLinkBtn = document.getElementById('add-link-btn');
    const contextMenu = document.getElementById('context-menu');
    const removeBtn = document.getElementById('remove-btn');
    const editBtn = document.getElementById('edit-btn');
    const gridContainer = document.querySelector('.grid-container');

    let GRID_COLS = 8;
    let gridArray = [];

    // Grid configuration
    async function gridConfiguration() {
        return new Promise((resolve, reject) => {
            chrome.storage.sync.get(['grid', 'links'], (result) => {
                if (result.grid) {
                    GRID_COLS = result.grid.col;
                } else {
                    chrome.storage.sync.set({ grid: { col: 8 } });
                    GRID_COLS = 8;
                }
                gridArray = result.links;
                resolve(gridArray);
            });
        });
    }

    // Creates the grid structure
    async function createGrid() {
        await gridConfiguration();
        const linkSizeVal = await getLinkSize();
        const sizeLink = linkSizeVal * 0.47;

        if (!gridContainer) return;

        const LINK_SIZE = Math.floor(sizeLink * 16);

        gridContainer.style.maxWidth = `${(GRID_COLS * LINK_SIZE + (GRID_COLS * 10))}px`;
        // gridContainer.innerHTML = ''; // Be careful clearing this if calling multiple times, but ok for init
    }

    // --- FIX: Completely rewritten renderLink to fix scope and icon logic ---
    async function renderLink(name, url, customIcon, icone, id) {
        const fullUrl = url?.startsWith('http') ? url : ('https://' + (url || ''));
        const finalId = id || generateId(); // Ensure ID exists
        const iconId = "icon_" + finalId;

        let hostname;
        try { hostname = new URL(fullUrl).hostname; } catch (e) { hostname = url || ''; }

        const newLink = document.createElement('a');
        newLink.href = fullUrl;
        newLink.className = 'quick-link';
        newLink.dataset.name = name;
        newLink.dataset.id = finalId;
        
        // Store customIcon in dataset so it persists when saving grid later
        if (customIcon) newLink.dataset.customIcon = customIcon;
        if (icone) newLink.dataset.icone = icone;

        // Image Element
        const iconImg = document.createElement('img');
        iconImg.className = 'link-icon';
        iconImg.alt = '';
        
        // Default fallback
        const fallbackIcon = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="100%" height="100%" fill="#444"/><text x="50%" y="55%" font-size="20" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif">?</text></svg>';
        iconImg.onerror = () => { iconImg.src = fallbackIcon; };

        // LOGIC: Custom Icon -> Legacy 'icone' -> Cached Favicon -> Fetch New Favicon
        if (customIcon) {
            iconImg.src = customIcon;
        } else if (icone) {
            iconImg.src = icone;
        } else {
            // Check local storage for cached favicon
            iconImg.src = fallbackIcon; // Temporary placeholder
            
            chrome.storage.local.get({ icons: {} }, async (res) => {
                if (res.icons && res.icons[iconId]) {
                    // Found in cache
                    iconImg.src = res.icons[iconId];
                } else {
                    // Not found, fetch it
                    try {
                        const base64 = await faviconToBase64(hostname);
                        if (base64) {
                            iconImg.src = base64;
                            // Save to cache
                            const icons = res.icons || {};
                            icons[iconId] = base64;
                            chrome.storage.local.set({ icons });
                        }
                    } catch (err) {
                        console.log("Error fetching favicon", err);
                    }
                }
            });
        }

        const newLinkSpan = document.createElement('span');
        newLinkSpan.className = 'link-text';
        newLinkSpan.innerText = name;

        newLink.appendChild(iconImg);
        newLink.appendChild(newLinkSpan);

        newLink.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showContextMenu(e, newLink);
        });
        return newLink;
    }

    // Carrega e renderiza links
    async function loadLinks() {
        gridContainer.innerHTML = ''; // Clear once before loading
        await createGrid();
        setLinkSize();

        const result = await chrome.storage.sync.get('links');
        const links = result.links || [];

        for (const link of links) {
            const linkEl = await renderLink(link.name, link.url, link.customIcon, link.icone, link.id);
            gridContainer.appendChild(linkEl);
        }
    }

    // NOTE: Removed 'addLink' function as it created a race condition with the Save inside Form Submit.
    // We now update DOM -> Then Save DOM state.

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    // state for editing
    let activeLink = null;
    let isEditing = false;
    let editingLink = null;
    let editingId = null;

    function removeLink(linkElement) {
        if (!linkElement) return hideContextMenu();
        const link = linkElement.closest('.quick-link');
        if (!link) return hideContextMenu();

        link.remove();

        chrome.storage.sync.set({ links: getLinksFromGrid() }, () => {
            hideContextMenu();
        });
    }

    async function getLinkById(id) {
        const result = await getGridArray();
        gridArray = result.links || [];
        return gridArray.find(link => link.id === id) || null;
    }

    async function getGridArray() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['links'], (result) => {
                const arr = result.links || [];
                gridArray = arr;
                resolve(arr);
            });
        });
    }

    function openEditFor(linkElement) {
        if (!linkElement) return;
        const link = linkElement.closest('.quick-link');
        if (!link) return;
        editingLink = link;
        editingId = link.dataset.id;
        console.log('edit log: ', editingId)

        isEditing = true;
        activeLink = linkElement;

        document.getElementById('site-name').value = linkElement.dataset.name || '';
        document.getElementById('site-url').value = linkElement.href || '';

        showOverlay();
    }

    function getLinksFromGrid() {
        const items = document.querySelectorAll('.quick-link');
        return Array.from(items).map(item => ({
            id: item.dataset.id,
            name: item.dataset.name,
            url: item.href,
            customIcon: item.dataset.customIcon || null,
            icone: item.dataset.icone || null // Preserve legacy icon data if exists
        }));
    }

    // UI helpers
    function showOverlay() {
        closeMenu();
        hideTutorialHighlight();
        if (!overlay) return;
        overlay.style.display = 'flex';
        const nameInput = document.getElementById('site-name');
        if (nameInput) nameInput.focus();
    }

    function hideOverlay() {
        if (!overlay) return;
        overlay.style.display = 'none';
        if (form) form.reset();
        isEditing = false;
        activeLink = null;
        editingLink = null;
        editingId = null;
    }

    function hideContextMenu() {
        if (!contextMenu) return;
        contextMenu.style.display = 'none';
        activeLink = null;
    }

    function initSortable() {
        const container = document.getElementById('grid-container');
        if(!container) return;

        new Sortable(container, {
            animation: 150,
            ghostClass: 'ghost',
            group: {
                name: 'grid',
                pull: false,
                put: false
            },
            onEnd: function (evt) {
                chrome.storage.sync.set({ links: getLinksFromGrid() });
            }
        });
    }

    addLinkBtn.addEventListener('click', showOverlay);
    closeOverlayBtn.addEventListener('click', hideOverlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) hideOverlay(); });

    removeBtn.addEventListener('click', () => {
        if (activeLink) removeLink(activeLink);
        hideContextMenu();
    });

    editBtn.addEventListener('click', () => {
        if (activeLink) openEditFor(activeLink);
        hideContextMenu();
    });

    function showContextMenu(event, linkElement) {
        event.preventDefault();
        event.stopPropagation();
        activeLink = linkElement;
        
        const menuWidth = contextMenu.offsetWidth;
        const menuHeight = contextMenu.offsetHeight;
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        let x = event.clientX, y = event.clientY;
        if (x + menuWidth > windowWidth) x = windowWidth - menuWidth;
        if (y + menuHeight > windowHeight) y = windowHeight - menuHeight;
        contextMenu.style.top = `${y}px`;
        contextMenu.style.left = `${x}px`;
        contextMenu.style.display = 'block';
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const siteName = document.getElementById('site-name').value.trim();
        let siteUrl = document.getElementById('site-url').value.trim();
        const fileInput = document.getElementById('custom-icon');
        const file = fileInput?.files[0];

        if (!siteName || !siteUrl) {
            alert('Please fill all required fields.');
            return;
        }
        if (!siteUrl.startsWith('http')) siteUrl = 'https://' + siteUrl;

        let customIcon = null;
        if (file) {
            try { customIcon = await convertToBase64(file); } catch (err) { console.error(err); }
        }

        if (isEditing && editingId) {
            // EDIT MODE
            const existing = await getLinkById(editingId) || {};
            
            // Note: We don't save to array here, we rely on DOM replacement + final save
            const updatedCustomIcon = customIcon || existing.customIcon || null;
            const updatedIcone = existing.icone || null;

            // Render new element
            const newEl = await renderLink(siteName, siteUrl, updatedCustomIcon, updatedIcone, editingId);
            
            // Replace in DOM
            if (editingLink && editingLink.parentNode) {
                editingLink.parentNode.replaceChild(newEl, editingLink);
            }

            // Cleanup
            isEditing = false;
            activeLink = null;
            editingLink = null;
            editingId = null;

        } else {
            // NEW LINK MODE
            const id = generateId();
            
            // Create DOM Element
            const linkEl = await renderLink(siteName, siteUrl, customIcon, null, id);
            gridContainer.appendChild(linkEl);
        }

        // --- FINAL SAVE ---
        // Scrapes the current state of the DOM and saves it. 
        // This prevents race conditions between "addLink" and "renderLink".
        chrome.storage.sync.set({ links: getLinksFromGrid() }, () => {
            hideOverlay();
            form.reset();
        });
    });

    window.addEventListener('click', (e) => {
        if (contextMenu.style.display === 'block' && !contextMenu.contains(e.target)) {
            hideContextMenu();
        }
    });

    function showTutorialHighlight() {
        const tutorialOverlay = document.getElementById('tutorial');
        const button = document.getElementById('add-link-btn');
        const circle1 = document.getElementById('circle1');
        const circle2 = document.getElementById('circle2');

        if(tutorialOverlay) tutorialOverlay.style.display = 'block';

        if (!button || !circle1 || !circle2) return;

        button.style.boxShadow = '0 0 15px 5px rgba(92, 121, 250, 0.45)';

        const rect = button.getBoundingClientRect();
        const rectCircle1 = circle1.getBoundingClientRect();
        const rectCircle2 = circle2.getBoundingClientRect();

        const buttonCenterX = rect.left + (rect.width / 2);
        const buttonCenterY = rect.top + (rect.height / 2);

        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight

        const circle1Bottom = (viewportHeight - buttonCenterY) - (rectCircle1.height / 2);
        const circle1Right = (viewportWidth - buttonCenterX) - (rectCircle1.width / 2);

        const circle2Bottom = (viewportHeight - buttonCenterY) - (rectCircle2.height / 2);
        const circle2Right = (viewportWidth - buttonCenterX) - (rectCircle2.width / 2);

        circle1.style.bottom = `${circle1Bottom}px`;
        circle1.style.right = `${circle1Right}px`;

        circle2.style.bottom = `${circle2Bottom}px`;
        circle2.style.right = `${circle2Right}px`;
    }

    function hideTutorialHighlight() {
        const tutorialOverlay = document.getElementById('tutorial');
        const button = document.getElementById('add-link-btn');
        if(tutorialOverlay) tutorialOverlay.style.display = 'none';
        if(button) button.style.boxShadow = '';

        chrome.storage.sync.set({ showTutorial: false });
    }

    chrome.storage.sync.get(['showTutorial'], (result) => {
        if (result.showTutorial) {
            showTutorialHighlight();
        }
    });

    function convertToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }

    // SETTINGS & HELPERS
    const openBtn = document.getElementById('open-settings-btn');
    const closeBtn = document.getElementById('close-settings-btn');
    const backdrop = document.getElementById('settings-backdrop');
    const settingsMenu = document.getElementById('settings-menu');
    const changeBgBtn = document.getElementById('change-bg-btn');
    const exportLinksBtn = document.getElementById('export-links-btn');
    const importLinksBtn = document.getElementById('import-links-btn');
    const fileInput = document.getElementById('selectFiles');
    const changeBgInput = document.getElementById('change-bg-input');
    const resetBgBtn = document.getElementById('reset-bg-settings-btn');
    const closeNotificationBtn = document.getElementById('close-notification-btn');
    const displayContainer = document.getElementById('img-display-container');
    const btnColMaxGrid = document.getElementById('max-col');
    const btnColMinGrid = document.getElementById('min-col');
    const inputColGrid = document.getElementById('col');
    const resetLinksBtn = document.getElementById('reset-links-settings-btn');
    const clearListBtn = document.getElementById('clear-list-btn');
    const linkSizeInput = document.getElementById('link-size-input');
    const widthCheckbox = document.getElementById('width-checkbox');

    const openMenu = () => {
        hideOverlay();
        backdrop.style.display = 'block';
        settingsMenu.style.display = 'flex';
    };

    const closeMenu = () => {
        backdrop.style.display = 'none';
        settingsMenu.style.display = 'none';
    };

    const resetLinks = () => {
        if (confirm('Are you sure you want to reset all links? This action cannot be undone.')) {
            chrome.storage.sync.set({ links: [] }, () => {
                loadLinks();
                closeMenu();
                showNotification("Success. All links have been reset.");
            });
        }
    }

    const exportLinks = () => {
        chrome.storage.sync.get(['links'], (result) => {
            var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(result.links));
            var dlAnchorElem = document.getElementById('downloadAnchorElem');
            dlAnchorElem.setAttribute("href", dataStr);
            dlAnchorElem.setAttribute("download", "websiteLinks.json");
            dlAnchorElem.click();
        });
    };

    const importLinks = () => {
        fileInput.click();
    };

    const importLinksInput = () => {
        const files = fileInput.files;
        if (files.length === 0) return false;

        const fr = new FileReader();
        fr.onload = () => {
            try {
                const linksJson = JSON.parse(fr.result);
                chrome.storage.sync.set({ links: linksJson }, () => {
                    loadLinks();
                    closeMenu();
                    fileInput.value = '';
                });
            } catch (err) {
                console.error("Invalid JSON file:", err);
            }
        };
        fr.readAsText(files[0]);
    };

    const changeBgButton = () => {
        changeBgInput.click();
    };

    function getIdArray() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['idArray'], (result) => {
                const idArray = result.idArray || [];
                resolve(idArray);
            });
        });
    }

    const changeBg = async () => {
        let imgBg = changeBgInput?.files;
        if (!imgBg || imgBg.length === 0) return false;

        for (let i = 0; i < imgBg.length; i++) {
            const base64 = await convertToBase64(imgBg[i]);
            await addBackground(base64);
        }

        const idArray = await getIdArray();
        showNotification("Success. Background picture changed successfully");

        if (idArray.length === 1) await loadBackground();
        changeBgInput.value = '';
    }

    function initSortableDisplay() {
        const container = document.getElementById('img-display-container');
        if(!container) return; 

        new Sortable(container, {
            animation: 150,
            ghostClass: 'ghost',
            group: {
                name: 'backgrounds-settings',
                pull: false,
                put: false
            },
            onEnd: function (evt) {
                chrome.storage.local.set({ idArray: getLinksFromDisplayArray() });
            }
        });
    }

    function getLinksFromDisplayArray() {
        const items = document.querySelectorAll('#img-display-container .div-display');
        return Array.from(items).map(item => item.id);
    }

    async function loadImageDisplay(idArray) {
        if (displayContainer && displayContainer.childElementCount === 0) {
            for (let i = 0; i < idArray.length; i++) {
                await addDisplayImage(idArray[i]);
            }
            initSortableDisplay();
        }
    }

    async function addDisplayImage(idArray) {
        const imgSrc = await getBackground(idArray);

        const divElem = document.createElement('div');
        divElem.style.position = 'relative';
        divElem.className = 'div-display';
        divElem.id = idArray;

        const aElem = document.createElement('button');
        aElem.className = 'img-display-a';

        const btnElem = document.createElement('img');
        btnElem.className = 'img-display-btn';
        btnElem.src = 'icons/svg/trash.svg';

        const imgElem = document.createElement('img');
        imgElem.src = imgSrc;
        imgElem.className = 'img-display-back';

        aElem.appendChild(imgElem);
        aElem.appendChild(btnElem);
        divElem.appendChild(aElem);
        displayContainer.appendChild(divElem);

        aElem.addEventListener('click', () => removeBg(divElem.id));
    }

    async function removeDisplayImage(id) {
        const divElem = document.getElementById(id);
        if(divElem) divElem.remove();
    }

    const resetBg = async () => {
        if (confirm('Are you sure you want to reset the backgrounds? This action cannot be undone.')) {
            resetBack();
            showNotification("Success. Background reseted successfully");
        }
    }

    async function resetBack() {
        await clearBgList();
        if(displayContainer) displayContainer.innerHTML = '';
        await loadDefaultBackgrounds();
        loadBackground();
    }

    function showNotification(message) {
        const notif = document.getElementById('notification');
        if(!notif) return;
        document.getElementById('notif-message').innerText = message;
        notif.style.opacity = "1";
        setTimeout(() => {
            closeNotification();
        }, 3000);
    }

    function closeNotification() {
        const notif = document.getElementById('notification');
        if(notif) notif.style.opacity = "0";
    }

    async function removeBg(id) {
        let idArrayB = await getIdArray();
        idArrayB = idArrayB.filter(item => item !== id);

        await chrome.storage.local.set({ idArray: idArrayB });
        chrome.storage.local.remove(id);
        removeDisplayImage(id);
    };

    function setGridDefaults() {
        chrome.storage.sync.get(['grid'], (result) => {
            if (result.grid) {
                inputColGrid.value = result.grid.col || 8;
            } else {
                chrome.storage.sync.set({ grid: { col: 8 } });
                inputColGrid.value = 8;
            }
        });
    }

    function clamp(value, min = 1, max = 15) {
        return Math.min(Math.max(value, min), max);
    }

    function inputGrid(input) {
        const value = clamp(Number(input.value));
        input.value = value;
        saveGrid(value);
    }

    function maxGrid(input) {
        const value = clamp(Number(input.value) + 1);
        input.value = value;
        saveGrid(value);
    }

    function minGrid(input) {
        const value = clamp(Number(input.value) - 1);
        input.value = value;
        saveGrid(value);
    }

    async function saveGrid(value) {
        const stored = await chrome.storage.sync.get('grid');
        const grid = stored.grid || { col: 8 };
        grid.col = value;

        chrome.storage.sync.set({ grid });
        // gridContainer.innerHTML = ''; // This is done inside loadLinks
        await loadLinks();
        initSortable();
    }

    async function clearBgList() {
        const arrayId = await getIdArray();
        for (let i = 0; i < arrayId.length; i++) {
            chrome.storage.local.remove(arrayId[i]);
        }
        await chrome.storage.local.set({ idArray: [] });
        await chrome.storage.sync.set({ lastImageIndex: 0 });
    }

    const clearBg = async () => {
        await clearBgList();
        await loadBackground();
        showNotification('Success. Background list cleared successfully');
        if(displayContainer) displayContainer.innerHTML = '';
    }

    const linkSize = async () => {
        const linkSize = linkSizeInput.value;
        const sizeLink = linkSize * 0.47;
        const sizeText = linkSize * 0.07;

        await chrome.storage.sync.set({ linkSize: linkSize });

        document.documentElement.style.setProperty("--link-size", sizeLink + "rem");
        document.documentElement.style.setProperty("--text-link-size", sizeText + "em");

        const result = await chrome.storage.sync.get('grid');
        GRID_COLS = result.grid.col || 8;
        const LINK_SIZE = Math.ceil(sizeLink) * 16;
        gridContainer.style.maxWidth = `${(GRID_COLS * LINK_SIZE + (GRID_COLS * 10))}px`;
    }

    async function setLinkSize() {
        const linkSize = await getLinkSize();
        linkSizeInput.value = linkSize;
        const sizeLink = linkSize * 0.47;
        const sizeText = linkSize * 0.07;
        document.documentElement.style.setProperty("--link-size", sizeLink + "rem");
        document.documentElement.style.setProperty("--text-link-size", sizeText + "em");
    }

    async function getLinkSize() {
        const result = await chrome.storage.sync.get('linkSize');
        return result.linkSize || 7;
    }

    document.querySelectorAll(".position-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            switch (btn.dataset.position) {
                case "top-left":
                    document.documentElement.style.setProperty("--link-container-vertical", "flex-start");
                    document.documentElement.style.setProperty("--link-container-horizontal", "flex-start");
                    break;
                case "top-center":
                    document.documentElement.style.setProperty("--link-container-vertical", "flex-start");
                    document.documentElement.style.setProperty("--link-container-horizontal", "center");
                    break;
                case "top-right":
                    document.documentElement.style.setProperty("--link-container-vertical", "flex-start");
                    document.documentElement.style.setProperty("--link-container-horizontal", "flex-end");
                    break;
                case "left":
                    document.documentElement.style.setProperty("--link-container-vertical", "center");
                    document.documentElement.style.setProperty("--link-container-horizontal", "flex-start");
                    break;
                case "center":
                    document.documentElement.style.setProperty("--link-container-vertical", "center");
                    document.documentElement.style.setProperty("--link-container-horizontal", "center");
                    break;
                case "right":
                    document.documentElement.style.setProperty("--link-container-vertical", "center");
                    document.documentElement.style.setProperty("--link-container-horizontal", "flex-end");
                    break;
                case "bottom-left":
                    document.documentElement.style.setProperty("--link-container-vertical", "flex-end");
                    document.documentElement.style.setProperty("--link-container-horizontal", "flex-start");
                    break;
                case "bottom-center":
                    document.documentElement.style.setProperty("--link-container-vertical", "flex-end");
                    document.documentElement.style.setProperty("--link-container-horizontal", "center");
                    break;
                case "bottom-right":
                    document.documentElement.style.setProperty("--link-container-vertical", "flex-end");
                    document.documentElement.style.setProperty("--link-container-horizontal", "flex-end");
                    break;
            }
            setPosition();
        });
    });

    async function setPosition() {
        const vertical = document.documentElement.style.getPropertyValue("--link-container-vertical");
        const horizontal = document.documentElement.style.getPropertyValue("--link-container-horizontal");
        chrome.storage.sync.set({ linkPosition: { ver: vertical, hor: horizontal } });
    }

    async function getPosition() {
        const result = await chrome.storage.sync.get('linkPosition');
        return result.linkPosition || { ver: "flex-start", hor: "flex-start" }
    }

    async function loadPosition() {
        const position = await getPosition();
        document.documentElement.style.setProperty("--link-container-vertical", position.ver);
        document.documentElement.style.setProperty("--link-container-horizontal", position.hor);
    }

    const fullWidth = () => {
        if (widthCheckbox.checked) {
            document.documentElement.style.setProperty("--box-width", "100%");
        } else {
            document.documentElement.style.setProperty("--box-width", "1920px");
        }
        setFullWidth();
    }

    function setFullWidth() {
        const fullWidth = document.documentElement.style.getPropertyValue("--box-width");
        const isFullWidth = fullWidth === "100%";
        chrome.storage.sync.set({ fullWidth: isFullWidth });
    }

    async function getFullWidth() {
        const result = await chrome.storage.sync.get('fullWidth');
        return result.fullWidth || true;
    }

    async function loadFullWidth() {
        const isFullWidth = await getFullWidth();
        const fullWidth = isFullWidth ? "100%" : "1920px"
        widthCheckbox.checked = isFullWidth;
        document.documentElement.style.setProperty("--box-width", fullWidth);
    }

    async function faviconToBase64(hostname) {
        return chrome.runtime.sendMessage({
            action: "fetchFavicon",
            hostname
        });
    }

    init();

    // Event Listeners
    openBtn.addEventListener('click', openMenu);
    closeBtn.addEventListener('click', closeMenu);
    backdrop.addEventListener('click', closeMenu);
    exportLinksBtn.addEventListener('click', exportLinks);
    changeBgBtn.addEventListener('click', changeBgButton);
    changeBgInput.addEventListener('change', changeBg)
    importLinksBtn.addEventListener('click', importLinks);
    fileInput.addEventListener('change', importLinksInput);
    resetBgBtn.addEventListener('click', resetBg);
    closeNotificationBtn.addEventListener('click', closeNotification);
    btnColMaxGrid.addEventListener('click', () => maxGrid(inputColGrid));
    btnColMinGrid.addEventListener('click', () => minGrid(inputColGrid));
    inputColGrid.addEventListener('change', () => inputGrid(inputColGrid));
    resetLinksBtn.addEventListener('click', resetLinks);
    clearListBtn.addEventListener('click', clearBg);
    linkSizeInput.addEventListener('input', linkSize);
    widthCheckbox.addEventListener('change', fullWidth);

});
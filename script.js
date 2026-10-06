/**
 * NOCTUN TAROT — pedido (carrinho), menu e animações
 *
 * Os produtos são lidos dos botões [data-add] do HTML (data-id, data-name, data-price).
 * Para mudar nome ou preço de um serviço, altere o botão e o preço exibido ao lado dele.
 */
(() => {
    'use strict';

    const WHATSAPP_NUMBER = '5524999894376';
    const RUSH = { name: 'Furar fila (atendimento imediato)', price: 50 };
    const STORAGE_KEY = 'noctun:pedido:v1';
    const MAX_QTY = 20;

    const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    const formatBRL = (value) => brl.format(value);
    const plural = (n) => (n === 1 ? 'item' : 'itens');

    // =====================================================
    // 1. Catálogo (fonte única: os botões do HTML)
    // =====================================================
    const catalog = new Map();
    document.querySelectorAll('[data-add]').forEach((btn) => {
        const { id, name } = btn.dataset;
        const price = Number(btn.dataset.price);
        if (!id || !name || !Number.isFinite(price)) return;
        catalog.set(id, { name, price });
        btn.setAttribute('aria-label', `Adicionar ${name} ao pedido`);
    });

    // =====================================================
    // 2. Estado do pedido
    //    Guardamos só id + quantidade; nome e preço vêm sempre
    //    do catálogo atual (evita preço antigo salvo no navegador).
    // =====================================================
    let state = loadState();

    function clampQty(value) {
        const qty = Math.floor(Number(value));
        return Number.isFinite(qty) ? Math.min(Math.max(qty, 1), MAX_QTY) : 1;
    }

    function loadState() {
        const empty = { items: [], rush: false };
        try {
            const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (!data || !Array.isArray(data.items)) return empty;

            const merged = new Map();
            data.items.forEach((item) => {
                if (!item || !catalog.has(item.id)) return;
                merged.set(item.id, clampQty((merged.get(item.id) || 0) + clampQty(item.qty)));
            });
            const items = [...merged].map(([id, qty]) => ({ id, qty }));
            return { items, rush: Boolean(data.rush) && items.length > 0 };
        } catch {
            return empty;
        }
    }

    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch {
            // Navegação privada ou armazenamento bloqueado: o pedido segue só nesta aba.
        }
    }

    function lineItems() {
        return state.items.map(({ id, qty }) => {
            const { name, price } = catalog.get(id);
            return { id, qty, name, price, total: price * qty };
        });
    }

    const itemCount = () => state.items.reduce((sum, item) => sum + item.qty, 0);
    const rushActive = () => state.rush && state.items.length > 0;
    const orderTotal = () =>
        lineItems().reduce((sum, item) => sum + item.total, 0) + (rushActive() ? RUSH.price : 0);

    function findItem(id) {
        return state.items.find((item) => item.id === id);
    }

    function addItem(id) {
        const item = findItem(id);
        if (item) item.qty = clampQty(item.qty + 1);
        else state.items.push({ id, qty: 1 });
        commit();
    }

    function setQty(id, qty) {
        const item = findItem(id);
        if (!item) return;
        item.qty = clampQty(qty);
        commit();
    }

    function removeItem(id) {
        state.items = state.items.filter((item) => item.id !== id);
        if (!state.items.length) state.rush = false;
        commit();
    }

    function commit() {
        saveState();
        render();
    }

    // =====================================================
    // 3. Interface do pedido
    // =====================================================
    const ui = {
        list: document.querySelector('[data-cart-list]'),
        empty: document.querySelector('[data-cart-empty]'),
        foot: document.querySelector('[data-cart-foot]'),
        counts: document.querySelectorAll('[data-cart-count]'),
        countLabels: document.querySelectorAll('[data-cart-count-label]'),
        totals: document.querySelectorAll('[data-cart-total]'),
        badge: document.querySelector('.badge'),
        cartBtn: document.querySelector('.cart-btn'),
        fab: document.querySelector('.cart-fab'),
        rush: document.querySelector('[data-rush]'),
        checkout: document.querySelector('[data-checkout]'),
    };

    const ITEM_TEMPLATE = `
        <div>
            <p class="cart-item-name"></p>
            <p class="cart-item-unit"></p>
        </div>
        <p class="cart-item-total"></p>
        <div class="cart-item-actions">
            <div class="qty" role="group">
                <button type="button" data-action="dec"><svg aria-hidden="true"><use href="#i-minus"/></svg></button>
                <output></output>
                <button type="button" data-action="inc"><svg aria-hidden="true"><use href="#i-plus"/></svg></button>
            </div>
            <button type="button" class="remove-btn" data-action="remove">
                <svg aria-hidden="true"><use href="#i-trash"/></svg>Remover
            </button>
        </div>`;

    function createItemEl(id) {
        const li = document.createElement('li');
        li.className = 'cart-item';
        li.dataset.id = id;
        li.innerHTML = ITEM_TEMPLATE; // template fixo; dados entram só via textContent
        return li;
    }

    function updateItemEl(li, item) {
        li.querySelector('.cart-item-name').textContent = item.name;
        li.querySelector('.cart-item-unit').textContent =
            item.qty > 1 ? `${item.qty} × ${formatBRL(item.price)}` : formatBRL(item.price);
        li.querySelector('.cart-item-total').textContent = formatBRL(item.total);
        li.querySelector('output').textContent = String(item.qty);

        li.querySelector('.qty').setAttribute('aria-label', `Quantidade de ${item.name}`);
        const dec = li.querySelector('[data-action="dec"]');
        const inc = li.querySelector('[data-action="inc"]');
        dec.setAttribute('aria-label', `Diminuir quantidade de ${item.name}`);
        inc.setAttribute('aria-label', `Aumentar quantidade de ${item.name}`);
        dec.disabled = item.qty <= 1;
        inc.disabled = item.qty >= MAX_QTY;
        li.querySelector('[data-action="remove"]').setAttribute('aria-label', `Remover ${item.name} do pedido`);
    }

    // Atualiza a lista no lugar (sem recriar tudo), para não perder o foco
    // de quem usa teclado nem repetir a animação de entrada a cada clique.
    function renderList(items) {
        const existing = new Map([...ui.list.children].map((li) => [li.dataset.id, li]));
        items.forEach((item) => {
            let li = existing.get(item.id);
            if (!li) {
                li = createItemEl(item.id);
                ui.list.append(li);
            }
            existing.delete(item.id);
            updateItemEl(li, item);
        });
        existing.forEach((li) => li.remove());
    }

    function render() {
        const items = lineItems();
        const count = itemCount();
        const hasItems = items.length > 0;
        const totalText = formatBRL(orderTotal());

        ui.counts.forEach((el) => { el.textContent = String(count); });
        ui.countLabels.forEach((el) => { el.textContent = plural(count); });
        ui.totals.forEach((el) => { el.textContent = totalText; });

        ui.badge.hidden = !hasItems;
        ui.cartBtn.setAttribute('aria-label', hasItems ? `Abrir seu pedido (${count} ${plural(count)})` : 'Abrir seu pedido');
        ui.fab.hidden = !hasItems;
        document.body.classList.toggle('has-fab', hasItems);

        ui.empty.hidden = hasItems;
        ui.foot.hidden = !hasItems;
        ui.rush.checked = rushActive();

        renderList(items);
    }

    function bumpBadge() {
        ui.badge.classList.remove('bump');
        void ui.badge.offsetWidth; // reinicia a animação
        ui.badge.classList.add('bump');
    }

    // Feedback no próprio botão: "Adicionado" por um instante
    const flashTimers = new WeakMap();
    function flashAdded(btn) {
        const label = btn.querySelector('span');
        const icon = btn.querySelector('use');
        if (!label || !icon) return;
        if (!btn.dataset.label) btn.dataset.label = label.textContent;

        clearTimeout(flashTimers.get(btn));
        btn.classList.add('is-added');
        label.textContent = 'Adicionado';
        icon.setAttribute('href', '#i-check');

        flashTimers.set(btn, setTimeout(() => {
            btn.classList.remove('is-added');
            label.textContent = btn.dataset.label;
            icon.setAttribute('href', '#i-plus');
        }, 1600));
    }

    // =====================================================
    // 4. Avisos (toast) — anunciados por leitores de tela
    // =====================================================
    const toastRegion = document.querySelector('[data-toasts]');

    function toast(message) {
        const el = document.createElement('div');
        el.className = 'toast';
        el.innerHTML = '<svg aria-hidden="true"><use href="#i-check"/></svg>';
        const text = document.createElement('span');
        text.textContent = message;
        el.append(text);
        toastRegion.append(el);

        while (toastRegion.children.length > 2) toastRegion.firstElementChild.remove();

        setTimeout(() => {
            el.classList.add('is-leaving');
            setTimeout(() => el.remove(), 320);
        }, 2600);
    }

    // =====================================================
    // 5. Gaveta do pedido (diálogo modal)
    // =====================================================
    const drawer = document.getElementById('carrinho');
    const backdrop = document.querySelector('.drawer-backdrop');
    const closeBtn = drawer.querySelector('.drawer-head [data-cart-close]');
    const pageRegions = document.querySelectorAll('[data-page]');
    let lastFocus = null;

    const isCartOpen = () => drawer.classList.contains('is-open');

    function openCart() {
        if (isCartOpen()) return;
        lastFocus = document.activeElement;
        setMenu(false);
        toastRegion.replaceChildren(); // avisos ficariam por cima do cabeçalho da gaveta

        drawer.inert = false;
        drawer.classList.add('is-open');
        backdrop.classList.add('is-open');
        // Torna o resto da página inerte: o foco fica preso dentro do pedido
        pageRegions.forEach((el) => { el.inert = true; });
        document.body.classList.add('no-scroll');
        closeBtn.focus({ preventScroll: true });
    }

    function closeCart({ restoreFocus = true } = {}) {
        if (!isCartOpen()) return;
        drawer.classList.remove('is-open');
        backdrop.classList.remove('is-open');
        drawer.inert = true;
        pageRegions.forEach((el) => { el.inert = false; });
        document.body.classList.remove('no-scroll');

        if (restoreFocus && lastFocus && document.contains(lastFocus)) {
            lastFocus.focus({ preventScroll: true });
        }
    }

    // =====================================================
    // 6. Finalizar no WhatsApp
    // =====================================================
    function buildMessage() {
        const lines = ['Olá, Guilherme! 🔮 Vim pelo site e gostaria de fazer este pedido:', ''];
        lineItems().forEach((item) => {
            lines.push(`• ${item.qty}× ${item.name} — ${formatBRL(item.total)}`);
        });
        if (rushActive()) lines.push(`• ${RUSH.name} — ${formatBRL(RUSH.price)}`);
        lines.push(
            '',
            `*Total: ${formatBRL(orderTotal())}*`,
            '',
            '*Meus dados:*',
            'Nome completo: ',
            'Data de nascimento: ',
            'Contexto da história: ',
        );
        return lines.join('\n');
    }

    function checkout() {
        if (!state.items.length) {
            toast('Adicione uma leitura ao pedido primeiro.');
            return;
        }
        const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(buildMessage())}`;
        window.open(url, '_blank', 'noopener');
    }

    // =====================================================
    // 7. Menu mobile
    // =====================================================
    const header = document.querySelector('.site-header');
    const nav = document.getElementById('menu-principal');
    const menuBtn = document.querySelector('.menu-btn');

    function setMenu(open) {
        nav.classList.toggle('is-open', open);
        header.classList.toggle('menu-open', open);
        menuBtn.setAttribute('aria-expanded', String(open));
        menuBtn.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
        menuBtn.querySelector('use').setAttribute('href', open ? '#i-close' : '#i-menu');
    }

    menuBtn.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));

    // =====================================================
    // 8. Eventos (delegação: sem onclick no HTML)
    // =====================================================
    document.addEventListener('click', (event) => {
        const addBtn = event.target.closest('[data-add]');
        if (addBtn) {
            const product = catalog.get(addBtn.dataset.id);
            if (!product) return;
            addItem(addBtn.dataset.id);
            flashAdded(addBtn);
            bumpBadge();
            toast(`Adicionado ao pedido: ${product.name}`);
            return;
        }

        if (event.target.closest('[data-cart-open]')) {
            openCart();
            return;
        }

        const closer = event.target.closest('[data-cart-close]');
        if (closer) {
            // Link "Ver leituras" dentro do pedido: deixa o foco seguir para a seção
            closeCart({ restoreFocus: closer.tagName !== 'A' });
            return;
        }

        if (event.target.closest('[data-checkout]')) {
            checkout();
            return;
        }

        if (nav.classList.contains('is-open') && (event.target.closest('.site-nav a') || !event.target.closest('.site-header'))) {
            setMenu(false);
        }
    });

    ui.list.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-action]');
        if (!btn) return;
        const li = btn.closest('.cart-item');
        const id = li.dataset.id;
        const item = findItem(id);
        if (!item) return;

        if (btn.dataset.action === 'inc') setQty(id, item.qty + 1);
        if (btn.dataset.action === 'dec') setQty(id, item.qty - 1);

        // Se o botão focado ficou desabilitado (limite), leva o foco ao vizinho
        if (btn.disabled) {
            li.querySelector(btn.dataset.action === 'dec' ? '[data-action="inc"]' : '[data-action="dec"]').focus();
        }

        if (btn.dataset.action === 'remove') {
            const next = li.nextElementSibling || li.previousElementSibling;
            removeItem(id);
            (next ? next.querySelector('[data-action="remove"]') : closeBtn).focus();
        }
    });

    ui.rush.addEventListener('change', () => {
        state.rush = ui.rush.checked;
        commit();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (isCartOpen()) closeCart();
        else if (nav.classList.contains('is-open')) {
            setMenu(false);
            menuBtn.focus();
        }
    });

    // Mantém o pedido sincronizado entre abas abertas
    window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY) return;
        state = loadState();
        render();
    });

    // =====================================================
    // 9. Cabeçalho, seção ativa e animações de entrada
    // =====================================================
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const revealEls = document.querySelectorAll('[data-reveal]');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if ('IntersectionObserver' in window) {
        const navLinks = [...nav.querySelectorAll('a[href^="#"]')];
        const spied = [document.getElementById('inicio'), ...navLinks.map((a) => document.querySelector(a.getAttribute('href')))].filter(Boolean);

        const spy = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                navLinks.forEach((a) => {
                    const active = a.getAttribute('href') === `#${entry.target.id}`;
                    a.classList.toggle('is-active', active);
                    if (active) a.setAttribute('aria-current', 'true');
                    else a.removeAttribute('aria-current');
                });
            });
        }, { rootMargin: '-45% 0px -50% 0px' });
        spied.forEach((section) => spy.observe(section));
    }

    if (reduceMotion || !('IntersectionObserver' in window)) {
        revealEls.forEach((el) => el.classList.add('is-visible'));
    } else {
        const revealer = new IntersectionObserver((entries, observer) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
        revealEls.forEach((el) => revealer.observe(el));
    }

    document.querySelectorAll('[data-year]').forEach((el) => {
        el.textContent = String(new Date().getFullYear());
    });

    render();
    document.documentElement.dataset.ready = '';
})();

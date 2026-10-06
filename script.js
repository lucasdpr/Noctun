/**
 * NOCTUN TAROT — pedido (carrinho), menu, cartas interativas e animações
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
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    // Vibração curta de confirmação (Android). iPhone ignora; sem efeito colateral.
    function haptic(ms = 12) {
        try {
            if (navigator.vibrate) navigator.vibrate(ms);
        } catch {
            // navegador sem suporte
        }
    }

    // =====================================================
    // 1. Catálogo (fonte única: os botões do HTML)
    //    data-kind="produto" → vela/banho; sem ele → leitura/trabalho
    //    data-price-from     → preço "a partir de" (varia com as opções)
    //    data-options        → opções obrigatórias (ex.: "essencia cor")
    // =====================================================

    // Cada produto com opções recebe uma cópia do <template> (lista única de essências e cores)
    document.querySelectorAll('[data-opts-slot]').forEach((slot, index) => {
        const tpl = document.getElementById(slot.dataset.optsSlot);
        if (!tpl) return;
        const opts = tpl.content.firstElementChild.cloneNode(true);
        opts.querySelectorAll('input[type="radio"]').forEach((input) => { input.name = `opcao-${index}-${input.dataset.opt}`; });
        slot.replaceWith(opts);
    });

    // Valores aceitos em cada opção, lidos dos próprios templates
    const optionValues = {};
    document.querySelectorAll('template[id^="tpl-"]').forEach((tpl) => {
        tpl.content.querySelectorAll('[data-opt]').forEach((field) => {
            const key = field.dataset.opt;
            optionValues[key] = optionValues[key] || new Set();
            if (field.tagName === 'SELECT') {
                [...field.options].forEach((option) => { if (option.value) optionValues[key].add(option.value); });
            } else {
                optionValues[key].add(field.value);
            }
        });
    });

    const catalog = new Map();
    document.querySelectorAll('[data-add]').forEach((btn) => {
        const { id, name } = btn.dataset;
        const price = Number(btn.dataset.price);
        if (!id || !name || !Number.isFinite(price)) return;
        catalog.set(id, {
            name,
            price,
            from: btn.hasAttribute('data-price-from'),
            kind: btn.dataset.kind === 'produto' ? 'produto' : 'servico',
            options: (btn.dataset.options || '').split(/\s+/).filter(Boolean),
        });
        btn.setAttribute('aria-label', `Adicionar ${name} ao pedido`);
    });

    // =====================================================
    // 2. Estado do pedido
    //    Guardamos só id + quantidade (+ opções escolhidas); nome e preço
    //    vêm sempre do catálogo atual (evita preço antigo salvo no navegador).
    // =====================================================

    // Opções válidas para o produto; undefined = inválidas (item descartado)
    function cleanOpts(product, opts) {
        if (!product.options.length) return null;
        if (!opts || typeof opts !== 'object') return undefined;
        const clean = {};
        for (const key of product.options) {
            const value = opts[key];
            if (typeof value !== 'string' || !optionValues[key] || !optionValues[key].has(value)) return undefined;
            clean[key] = value;
        }
        return clean;
    }

    // Mesma vela com essência/cor diferentes = linhas diferentes no pedido
    const itemKey = (id, opts) => (opts ? [id, ...Object.values(opts)].join('|') : id);
    const isService = (item) => catalog.get(item.id).kind === 'servico';

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
                const product = item && catalog.get(item.id);
                if (!product) return;
                const opts = cleanOpts(product, item.opts);
                if (opts === undefined) return; // opção que não existe mais (ex.: cor retirada)
                const key = itemKey(item.id, opts);
                const prev = merged.get(key);
                merged.set(key, { id: item.id, qty: clampQty((prev ? prev.qty : 0) + clampQty(item.qty)), opts });
            });
            const items = [...merged.values()];
            return { items, rush: Boolean(data.rush) && items.some(isService) };
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
        return state.items.map(({ id, qty, opts }) => {
            const { name, price, from, kind } = catalog.get(id);
            const detail = opts ? Object.values(opts).join(', ') : '';
            return {
                key: itemKey(id, opts),
                id,
                qty,
                opts,
                name,
                price,
                from,
                kind,
                detail,
                fullName: detail ? `${name} (${detail})` : name,
                total: price * qty,
            };
        });
    }

    const itemCount = () => state.items.reduce((sum, item) => sum + item.qty, 0);
    const hasService = () => state.items.some(isService);
    const hasVariablePrice = () => state.items.some((item) => catalog.get(item.id).from);
    // "Furar fila" vale para a fila de leituras: só conta se houver leitura/trabalho no pedido
    const rushActive = () => state.rush && hasService();
    const orderTotal = () =>
        lineItems().reduce((sum, item) => sum + item.total, 0) + (rushActive() ? RUSH.price : 0);

    function findItem(key) {
        return state.items.find((item) => itemKey(item.id, item.opts) === key);
    }

    function addItem(id, opts = null) {
        const item = findItem(itemKey(id, opts));
        if (item) item.qty = clampQty(item.qty + 1);
        else state.items.push({ id, qty: 1, opts });
        commit();
    }

    function setQty(key, qty) {
        const item = findItem(key);
        if (!item) return;
        item.qty = clampQty(qty);
        commit();
    }

    function removeItem(key) {
        state.items = state.items.filter((item) => itemKey(item.id, item.opts) !== key);
        if (!hasService()) state.rush = false;
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
        rushWrap: document.querySelector('[data-rush-wrap]'),
        totalFrom: document.querySelectorAll('[data-total-from]'),
        totalLabel: document.querySelector('[data-total-label]'),
        variableNote: document.querySelector('[data-variable-note]'),
        checkout: document.querySelector('[data-checkout]'),
    };

    const ITEM_TEMPLATE = `
        <div>
            <p class="cart-item-name"></p>
            <p class="cart-item-detail"></p>
            <p class="cart-item-unit"></p>
        </div>
        <p class="cart-item-total"><small>a partir de</small><span></span></p>
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

    function createItemEl(item) {
        const li = document.createElement('li');
        li.className = 'cart-item';
        li.dataset.id = item.id;
        li.dataset.key = item.key;
        li.innerHTML = ITEM_TEMPLATE; // template fixo; dados entram só via textContent
        return li;
    }

    function unitText(item) {
        if (item.from) return `a partir de ${formatBRL(item.price)}${item.qty > 1 ? ' cada' : ''}`;
        return item.qty > 1 ? `${item.qty} × ${formatBRL(item.price)}` : formatBRL(item.price);
    }

    function updateItemEl(li, item) {
        li.querySelector('.cart-item-name').textContent = item.name;
        const detail = li.querySelector('.cart-item-detail');
        detail.textContent = item.opts ? Object.values(item.opts).join(' · ') : '';
        detail.hidden = !item.opts;
        li.querySelector('.cart-item-unit').textContent = unitText(item);
        li.querySelector('.cart-item-total small').hidden = !item.from;
        li.querySelector('.cart-item-total span').textContent = formatBRL(item.total);
        li.querySelector('output').textContent = String(item.qty);

        li.querySelector('.qty').setAttribute('aria-label', `Quantidade de ${item.fullName}`);
        const dec = li.querySelector('[data-action="dec"]');
        const inc = li.querySelector('[data-action="inc"]');
        dec.setAttribute('aria-label', `Diminuir quantidade de ${item.fullName}`);
        inc.setAttribute('aria-label', `Aumentar quantidade de ${item.fullName}`);
        dec.disabled = item.qty <= 1;
        inc.disabled = item.qty >= MAX_QTY;
        li.querySelector('[data-action="remove"]').setAttribute('aria-label', `Remover ${item.fullName} do pedido`);
    }

    // Atualiza a lista no lugar (sem recriar tudo), para não perder o foco
    // de quem usa teclado nem repetir a animação de entrada a cada clique.
    function renderList(items) {
        const existing = new Map([...ui.list.children].map((li) => [li.dataset.key, li]));
        items.forEach((item) => {
            let li = existing.get(item.key);
            if (!li) {
                li = createItemEl(item);
                ui.list.append(li);
            }
            existing.delete(item.key);
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

        const variable = hasVariablePrice();
        ui.totalFrom.forEach((el) => { el.hidden = !variable; });
        ui.totalLabel.textContent = variable ? 'Total estimado' : 'Total';
        ui.variableNote.hidden = !variable;

        ui.empty.hidden = hasItems;
        ui.foot.hidden = !hasItems;
        ui.rushWrap.hidden = !hasService();
        ui.rush.checked = rushActive();

        renderList(items);
    }

    function bumpBadge() {
        [ui.badge, ui.fab].forEach((el) => {
            el.classList.remove('bump');
            void el.offsetWidth; // reinicia a animação
            el.classList.add('bump');
        });
    }

    // Uma estrela dourada "voa" do botão até o pedido
    function flyToCart(fromEl) {
        const fabVisible = getComputedStyle(ui.fab).display !== 'none';
        const target = fabVisible ? ui.fab.querySelector('.cart-fab-count') : ui.cartBtn;
        if (reduceMotion || !target || !fromEl.animate) {
            bumpBadge();
            return;
        }
        const a = fromEl.getBoundingClientRect();
        const b = target.getBoundingClientRect();
        const x0 = a.left + a.width / 2;
        const y0 = a.top + a.height / 2;
        const dx = b.left + b.width / 2 - x0;
        const dy = b.top + b.height / 2 - y0;
        const lift = Math.min(160, Math.abs(dx) * 0.3 + 70);

        const el = document.createElement('span');
        el.className = 'fly';
        el.innerHTML = '<svg aria-hidden="true"><use href="#twinkle"/></svg>';
        el.style.left = `${x0}px`;
        el.style.top = `${y0}px`;
        document.body.append(el);

        el.animate([
            { transform: 'translate(0, 0) scale(0.4) rotate(0deg)', opacity: 0 },
            { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - lift}px) scale(1.3) rotate(140deg)`, opacity: 1, offset: 0.45 },
            { transform: `translate(${dx}px, ${dy}px) scale(0.45) rotate(300deg)`, opacity: 0.9 },
        ], { duration: 800, easing: 'cubic-bezier(0.45, 0.05, 0.55, 0.95)' }).onfinish = () => {
            el.remove();
            bumpBadge();
        };
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
        const items = lineItems();
        const services = items.filter((item) => item.kind === 'servico');
        const products = items.filter((item) => item.kind === 'produto');
        const line = (item) => `• ${item.qty}× ${item.fullName} — ${item.from ? 'a partir de ' : ''}${formatBRL(item.total)}`;
        const rushLine = rushActive() ? [`• ${RUSH.name} — ${formatBRL(RUSH.price)}`] : [];
        const variable = hasVariablePrice();

        const lines = ['Olá, Guilherme! 🔮 Vim pelo site e gostaria de fazer este pedido:', ''];
        if (services.length && products.length) {
            lines.push('*Leituras e trabalhos:*', ...services.map(line), ...rushLine, '', '*Velas e banhos:*', ...products.map(line));
        } else {
            lines.push(...items.map(line), ...rushLine);
        }
        lines.push('', `*Total: ${variable ? 'a partir de ' : ''}${formatBRL(orderTotal())}*`);
        if (variable) lines.push('_O valor das velas pode variar conforme a cor e a essência._');

        // Pede só os dados que fazem sentido para o que foi pedido
        lines.push('', '*Meus dados:*', 'Nome completo: ');
        if (services.length) lines.push('Data de nascimento: ', 'Contexto da história: ');
        if (products.length) lines.push('Cidade/bairro (para combinarmos a entrega): ');
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
            const id = addBtn.dataset.id;
            const product = catalog.get(id);
            if (!product) return;
            let opts = null;
            if (product.options.length) {
                opts = readOptions(addBtn.closest('[data-product]'), product);
                if (!opts) return; // faltou escolher: o erro aparece no próprio card
            }
            addItem(id, opts);
            flashAdded(addBtn);
            flyToCart(addBtn);
            haptic();
            toast(`Adicionado ao pedido: ${product.name}${opts ? ` (${Object.values(opts).join(', ')})` : ''}`);
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

        const oracleCloser = event.target.closest('[data-oracle-close]');
        if (oracleCloser) {
            closeOracle({ restoreFocus: oracleCloser.tagName !== 'A' });
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
        const key = li.dataset.key;
        const item = findItem(key);
        if (!item) return;

        if (btn.dataset.action === 'inc') setQty(key, item.qty + 1);
        if (btn.dataset.action === 'dec') setQty(key, item.qty - 1);

        // Se o botão focado ficou desabilitado (limite), leva o foco ao vizinho
        if (btn.disabled) {
            li.querySelector(btn.dataset.action === 'dec' ? '[data-action="inc"]' : '[data-action="dec"]').focus();
        }

        if (btn.dataset.action === 'remove') {
            const next = li.nextElementSibling || li.previousElementSibling;
            removeItem(key);
            (next ? next.querySelector('[data-action="remove"]') : closeBtn).focus();
        }
    });

    ui.rush.addEventListener('change', () => {
        state.rush = ui.rush.checked;
        commit();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (isOracleOpen()) closeOracle();
        else if (isCartOpen()) closeCart();
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
    const revealEls = document.querySelectorAll('[data-reveal]');

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

    // =====================================================
    // 9b. Opções das velas (essência e cor) e carrossel no celular
    // =====================================================
    const OPTION_NAMES = { essencia: 'a essência', cor: 'a cor' };

    function optionValue(card, key) {
        const fields = [...card.querySelectorAll(`[data-opt="${key}"]`)];
        if (!fields.length) return '';
        if (fields[0].tagName === 'SELECT') return fields[0].value;
        const checked = fields.find((field) => field.checked);
        return checked ? checked.value : '';
    }

    function setOptionError(card, missing) {
        const box = card.querySelector('[data-opts]');
        const error = card.querySelector('[data-opt-error]');
        card.querySelectorAll('[data-opt]').forEach((field) => {
            if (missing.includes(field.dataset.opt)) field.setAttribute('aria-invalid', 'true');
            else field.removeAttribute('aria-invalid');
        });
        if (!missing.length) {
            error.hidden = true;
            box.classList.remove('has-error');
            return;
        }
        error.textContent = `Escolha ${missing.map((key) => OPTION_NAMES[key] || key).join(' e ')}.`;
        error.hidden = false;
        box.classList.remove('has-error');
        void box.offsetWidth; // reinicia o "tremido"
        box.classList.add('has-error');
    }

    // Lê as opções escolhidas; se faltar alguma, mostra o erro e devolve null
    function readOptions(card, product) {
        const opts = {};
        const missing = [];
        product.options.forEach((key) => {
            const value = optionValue(card, key);
            if (value && optionValues[key] && optionValues[key].has(value)) opts[key] = value;
            else missing.push(key);
        });
        setOptionError(card, missing);
        if (!missing.length) return opts;
        card.querySelector(`[data-opt="${missing[0]}"]`).focus();
        haptic([18, 60, 18]);
        return null;
    }

    document.addEventListener('change', (event) => {
        const field = event.target.closest('[data-opt]');
        if (!field) return;
        const card = field.closest('[data-product]');
        if (field.type === 'radio') {
            const chosen = card.querySelector('[data-opt-chosen]');
            if (chosen) chosen.textContent = `· ${field.value}`;
        }
        if (field.tagName === 'SELECT') field.classList.toggle('is-empty', !field.value);
        // Some com o erro assim que a pessoa completa o que faltava
        const error = card.querySelector('[data-opt-error]');
        if (error && !error.hidden) {
            const product = catalog.get(card.querySelector('[data-add]').dataset.id);
            setOptionError(card, product.options.filter((key) => !optionValue(card, key)));
        }
    });
    document.querySelectorAll('[data-product] select[data-opt]').forEach((select) => {
        select.classList.toggle('is-empty', !select.value);
    });

    // Pontinhos que indicam qual card está visível no carrossel (celular)
    if ('IntersectionObserver' in window) {
        document.querySelectorAll('[data-rail]').forEach((rail) => {
            const dotsWrap = rail.nextElementSibling;
            if (!dotsWrap || !dotsWrap.matches('[data-rail-dots]')) return;
            const cards = [...rail.children];
            const dots = cards.map(() => dotsWrap.appendChild(document.createElement('span')));
            const observer = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    dots.forEach((dot, i) => dot.classList.toggle('is-active', cards[i] === entry.target));
                });
            }, { root: rail, threshold: 0.6 });
            cards.forEach((card) => observer.observe(card));
        });
    }

    // =====================================================
    // 10. Tiragens interativas: embaralhar de verdade, virar e ler
    // =====================================================

    // Os 22 Arcanos Maiores com o significado geral (tradicional) de cada carta.
    // A interpretação para a pergunta da pessoa fica para a leitura paga.
    const ARCANA = [
        { num: '0', name: 'O Louco', glyph: 'g-louco', keys: ['Recomeço', 'Liberdade', 'Fé'], meaning: 'Começos, liberdade e confiança no novo. Pede coragem para dar o primeiro passo, com leveza.' },
        { num: 'I', name: 'O Mago', glyph: 'g-mago', keys: ['Iniciativa', 'Habilidade', 'Poder pessoal'], meaning: 'Você tem os recursos para fazer acontecer. É hora de agir e colocar a intenção em prática.' },
        { num: 'II', name: 'A Sacerdotisa', glyph: 'g-sacerdotisa', keys: ['Intuição', 'Mistério', 'Silêncio'], meaning: 'Há algo que ainda não foi dito. Escute a voz interior antes de decidir.' },
        { num: 'III', name: 'A Imperatriz', glyph: 'g-imperatriz', keys: ['Afeto', 'Criatividade', 'Abundância'], meaning: 'Energia de cuidado, beleza e fertilidade. Momento de nutrir o que você quer ver florescer.' },
        { num: 'IV', name: 'O Imperador', glyph: 'g-imperador', keys: ['Estrutura', 'Firmeza', 'Proteção'], meaning: 'Organização, limites claros e responsabilidade. A estabilidade vem de assumir o controle.' },
        { num: 'V', name: 'O Hierofante', glyph: 'g-hierofante', keys: ['Tradição', 'Conselho', 'Compromisso'], meaning: 'Valores, aprendizado e laços firmes. Fala de orientação e de seguir o que tem raiz.' },
        { num: 'VI', name: 'Os Enamorados', glyph: 'g-enamorados', keys: ['União', 'Escolha', 'Desejo'], meaning: 'Conexão verdadeira e escolhas do coração. Pede decidir com sinceridade sobre o que você quer.' },
        { num: 'VII', name: 'O Carro', glyph: 'g-carro', keys: ['Avanço', 'Foco', 'Conquista'], meaning: 'Movimento e determinação. A vitória vem de manter a direção e o controle das emoções.' },
        { num: 'VIII', name: 'A Força', glyph: 'g-infinity', keys: ['Coragem', 'Paciência', 'Autoconfiança'], meaning: 'A força que vem do coração: domínio de si, gentileza e coragem para enfrentar o que assusta.' },
        { num: 'IX', name: 'O Eremita', glyph: 'g-eremita', keys: ['Reflexão', 'Recolhimento', 'Sabedoria'], meaning: 'Um tempo para olhar para dentro. As respostas chegam no silêncio e na calma.' },
        { num: 'X', name: 'A Roda da Fortuna', glyph: 'g-roda', keys: ['Ciclos', 'Mudança', 'Destino'], meaning: 'A roda gira: o que estava parado começa a se mover. Uma virada está em curso.' },
        { num: 'XI', name: 'A Justiça', glyph: 'g-scales', keys: ['Verdade', 'Equilíbrio', 'Decisão'], meaning: 'Verdade e consequências. Cada escolha volta com o seu peso justo.' },
        { num: 'XII', name: 'O Enforcado', glyph: 'g-enforcado', keys: ['Pausa', 'Entrega', 'Novo olhar'], meaning: 'Uma pausa necessária. Soltar o controle ajuda a enxergar a situação por outro ângulo.' },
        { num: 'XIII', name: 'A Morte', glyph: 'g-morte', keys: ['Transformação', 'Fim de ciclo', 'Renovação'], meaning: 'Raramente fala de morte literal: é o fim de um ciclo que abre espaço para o novo.' },
        { num: 'XIV', name: 'Temperança', glyph: 'g-cup', keys: ['Equilíbrio', 'Calma', 'Cura'], meaning: 'A medida certa. Paciência e harmonia acalmam o que estava em conflito.' },
        { num: 'XV', name: 'O Diabo', glyph: 'g-diabo', keys: ['Apego', 'Desejo', 'Sombra'], meaning: 'Desejos e padrões que prendem. Mostra o que seduz e precisa ser visto com honestidade.' },
        { num: 'XVI', name: 'A Torre', glyph: 'g-torre', keys: ['Ruptura', 'Revelação', 'Libertação'], meaning: 'O que estava mal construído cai. Uma revelação súbita abre caminho para a verdade.' },
        { num: 'XVII', name: 'A Estrela', glyph: 'g-star', keys: ['Esperança', 'Inspiração', 'Cura'], meaning: 'Depois da tempestade, a luz volta. Fé no futuro e renovação da esperança.' },
        { num: 'XVIII', name: 'A Lua', glyph: 'g-moon', keys: ['Intuição', 'Ilusão', 'Mistério'], meaning: 'Nem tudo está claro. Atenção ao que se esconde nas sombras e ao que a intuição avisa.' },
        { num: 'XIX', name: 'O Sol', glyph: 'g-sun', keys: ['Alegria', 'Clareza', 'Vitória'], meaning: 'Calor, verdade e sucesso. Energia de clareza e realização.' },
        { num: 'XX', name: 'O Julgamento', glyph: 'g-julgamento', keys: ['Despertar', 'Chamado', 'Renascimento'], meaning: 'Um chamado para rever o passado e seguir renovado. Hora de despertar.' },
        { num: 'XXI', name: 'O Mundo', glyph: 'g-world', keys: ['Realização', 'Plenitude', 'Conclusão'], meaning: 'Um ciclo se completa com sensação de vitória. Plenitude e integração.' },
    ];

    function shuffled(list) {
        const copy = list.slice();
        for (let i = copy.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    // Faíscas douradas saindo do centro de um elemento
    function burst(container, { count = 7, distance = 40, className = 'spark' } = {}) {
        if (reduceMotion || !container || !container.animate) return;
        for (let i = 0; i < count; i += 1) {
            const el = document.createElement('span');
            el.className = className;
            el.innerHTML = '<svg aria-hidden="true"><use href="#twinkle"/></svg>';
            container.append(el);
            const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
            const dist = distance + Math.random() * distance * 0.8;
            el.animate([
                { transform: 'translate(0, 0) scale(0) rotate(0deg)', opacity: 1 },
                { transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) scale(${0.5 + Math.random() * 0.7}) rotate(90deg)`, opacity: 0 },
            ], { duration: 750 + Math.random() * 300, delay: 150, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'both' })
                .onfinish = () => el.remove();
        }
    }

    const sparkle = (card) => burst(card.closest('.slot'));

    function setupBoard(board) {
        const cards = [...board.querySelectorAll('[data-card]')];
        const wrap = board.closest('.board-card');
        const info = wrap.querySelector('[data-board-info]');
        const kicker = info.querySelector('[data-info-kicker]');
        const title = info.querySelector('[data-info-title]');
        const keys = info.querySelector('[data-info-keys]');
        const text = info.querySelector('[data-info-text]');
        const count = wrap.querySelector('[data-count]');
        const allBtn = wrap.querySelector('[data-reveal-all]');
        const questions = board.dataset.questions ? document.getElementById(board.dataset.questions) : null;
        const defaults = [kicker.textContent, title.textContent, '', text.textContent];
        let busy = false;

        const isFlipped = (card) => card.classList.contains('is-flipped');
        const arcanumOf = (card) => ARCANA[Number(card.dataset.arcanum)];

        function label(card) {
            const arcanum = arcanumOf(card);
            card.setAttribute('aria-label', isFlipped(card)
                ? `${card.dataset.pos}: ${arcanum.name}. Toque para virar de volta.`
                : `${card.dataset.pos}: carta virada para baixo. Toque para revelar.`);
        }

        // Sorteia arcanos diferentes para cada posição (as cartas estão viradas para baixo)
        function deal() {
            const drawn = shuffled(ARCANA.map((_, i) => i)).slice(0, cards.length);
            cards.forEach((card, i) => {
                const arcanum = ARCANA[drawn[i]];
                card.dataset.arcanum = String(drawn[i]);
                card.querySelector('.tcard-num').textContent = arcanum.num;
                card.querySelector('.tcard-front use').setAttribute('href', `#${arcanum.glyph}`);
                card.querySelector('.tcard-name').textContent = arcanum.name;
                label(card);
            });
        }

        function showInfo(k, t, keyText, x) {
            kicker.textContent = k;
            title.textContent = t;
            keys.textContent = keyText;
            keys.hidden = !keyText;
            text.textContent = x;
            info.classList.remove('is-updating');
            void info.offsetWidth; // reinicia a animação do texto
            info.classList.add('is-updating');
        }

        function showCard(card) {
            const arcanum = arcanumOf(card);
            // No Templo do Diabo, o significado geral não responde à pergunta: isso fica para a leitura
            const answer = questions ? ` A resposta para “${card.dataset.text}” vem na leitura completa.` : '';
            showInfo(`${card.dataset.pos} · ${arcanum.num}`, arcanum.name, arcanum.keys.join(' · '), arcanum.meaning + answer);
        }

        function setCurrent(card) {
            cards.forEach((c) => c.classList.toggle('is-current', c === card));
            if (questions) {
                [...questions.children].forEach((li, i) => li.classList.toggle('is-lit', card !== null && cards[i] === card));
            }
        }

        function update() {
            const flipped = cards.filter(isFlipped).length;
            const all = flipped === cards.length;
            count.textContent = String(flipped);
            board.classList.toggle('has-flipped', flipped > 0);
            board.classList.toggle('is-complete', all);
            allBtn.querySelector('span').textContent = all ? 'Embaralhar' : 'Revelar todas';
            allBtn.querySelector('use').setAttribute('href', all ? '#i-shuffle' : '#i-eye');
        }

        function toggle(card) {
            if (busy) return;
            const reveal = !isFlipped(card);
            card.classList.toggle('is-flipped', reveal);
            label(card);
            if (reveal) {
                setCurrent(card);
                showCard(card);
                sparkle(card);
            } else if (card.classList.contains('is-current')) {
                setCurrent(null);
                showInfo(...defaults);
            }
            update();
        }

        function revealAll() {
            const hidden = cards.filter((c) => !isFlipped(c));
            board.classList.add('is-dealing');
            hidden.forEach((card, i) => {
                card.classList.add('is-flipped');
                label(card);
                setTimeout(() => sparkle(card), i * 110);
            });
            const last = hidden[hidden.length - 1];
            setCurrent(last);
            showCard(last);
            update();
            setTimeout(() => board.classList.remove('is-dealing'), hidden.length * 110 + 900);
        }

        // Embaralhar: vira tudo, junta num maço no centro, sorteia de novo e distribui
        function shuffle() {
            if (busy) return;
            busy = true;
            board.classList.add('is-busy');
            const wasOpen = cards.some(isFlipped);
            cards.forEach((card) => card.classList.remove('is-flipped'));
            setCurrent(null);
            showInfo('Embaralhando…', 'As cartas estão sendo misturadas', '', 'Em instantes, uma nova tiragem.');
            update();

            const finish = () => {
                cards.forEach((card) => ['--to-x', '--to-y', '--to-r'].forEach((prop) => card.style.removeProperty(prop)));
                board.classList.remove('is-busy', 'is-dealing-back');
                busy = false;
                showInfo('Nova tiragem', 'Toque nas cartas para revelar', '', defaults[3]);
                update();
            };

            if (reduceMotion) {
                deal();
                finish();
                return;
            }

            setTimeout(() => {
                const box = board.getBoundingClientRect();
                const cx = box.left + box.width / 2;
                const cy = box.top + box.height / 2;
                cards.forEach((card, i) => {
                    const r = card.getBoundingClientRect();
                    card.style.setProperty('--to-x', `${(cx - (r.left + r.width / 2)).toFixed(1)}px`);
                    card.style.setProperty('--to-y', `${(cy - (r.top + r.height / 2)).toFixed(1)}px`);
                    card.style.setProperty('--to-r', `${(i % 2 ? 1 : -1) * (3 + i * 2)}deg`);
                });
                board.classList.add('is-gathering');

                setTimeout(() => {
                    deal(); // troca as cartas enquanto estão empilhadas e viradas
                    burst(board, { count: 12, distance: 60, className: 'spark spark--center' });
                    board.classList.add('is-dealing-back');
                    board.classList.remove('is-gathering');
                    setTimeout(finish, cards.length * 90 + 750);
                }, 1000);
            }, wasOpen ? 650 : 50);
        }

        cards.forEach((card) => {
            card.addEventListener('click', () => {
                toggle(card);
                haptic(isFlipped(card) ? 14 : 8);
            });
        });

        allBtn.addEventListener('click', () => {
            if (busy) return;
            if (cards.every(isFlipped)) shuffle();
            else revealAll();
            haptic();
        });

        // Desktop: a carta inclina e reflete a luz seguindo o mouse
        if (finePointer && !reduceMotion) {
            cards.forEach((card) => {
                let rect = null;
                card.addEventListener('pointerenter', () => { rect = card.getBoundingClientRect(); });
                card.addEventListener('pointermove', (event) => {
                    if (event.pointerType !== 'mouse' || !rect || busy) return;
                    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
                    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
                    card.classList.add('is-tilting');
                    card.style.setProperty('--ry', `${((x - 0.5) * 24).toFixed(2)}deg`);
                    card.style.setProperty('--rx', `${((0.5 - y) * 24).toFixed(2)}deg`);
                    card.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
                    card.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
                    card.style.setProperty('--lift', '-6px');
                });
                card.addEventListener('pointerleave', () => {
                    rect = null;
                    card.classList.remove('is-tilting');
                    ['--rx', '--ry', '--gx', '--gy', '--lift'].forEach((prop) => card.style.removeProperty(prop));
                });
            });
        }

        deal(); // cada visita começa com uma tiragem diferente
        board.classList.add('is-interactive');
        update();
    }

    document.querySelectorAll('[data-board]').forEach(setupBoard);

    // Botões de compra espalhados pelo site (painéis, quiz, carta do dia):
    // nome e preço vêm do catálogo, nunca repetidos no HTML.
    const shortPrice = (value) => (Number.isInteger(value) ? `R$ ${value}` : formatBRL(value));
    document.querySelectorAll('[data-cta]').forEach((btn) => {
        const product = catalog.get(btn.dataset.id);
        if (!product) return;
        btn.querySelector('span').textContent = `${btn.dataset.cta} · ${shortPrice(product.price)}`;
        btn.setAttribute('aria-label', `${btn.dataset.cta}: adicionar ${product.name} ao pedido por ${formatBRL(product.price)}`);
    });


    // =====================================================
    // 11. Hero com profundidade + barra de progresso
    //     Um único laço requestAnimationFrame para scroll,
    //     mouse e inclinação do celular.
    // =====================================================
    const hero = document.querySelector('.hero');
    const catbarEl = document.querySelector('[data-catbar]');
    const progressBar = document.querySelector('[data-progress]');
    const tilt = { x: 0, y: 0 };      // alvo (mouse ou giroscópio)
    const smooth = { x: 0, y: 0 };    // valor suavizado aplicado
    let heroVisible = true;
    let frameId = 0;

    function frame() {
        frameId = 0;
        // leituras primeiro, escritas depois: evita recalcular o layout a cada quadro
        const y = window.scrollY;
        const scrollable = document.documentElement.scrollHeight - window.innerHeight;
        const heroHeight = hero.offsetHeight;
        const headerHeight = header.offsetHeight;
        const catbarTop = catbarEl ? catbarEl.getBoundingClientRect().top : Infinity;

        header.classList.toggle('is-scrolled', y > 8);
        if (catbarEl) catbarEl.classList.toggle('is-stuck', catbarTop <= headerHeight + 1);
        progressBar.style.transform = `scaleX(${scrollable > 0 ? clamp(y / scrollable, 0, 1).toFixed(4) : 0})`;

        if (reduceMotion || !heroVisible) return;

        smooth.x += (tilt.x - smooth.x) * 0.1;
        smooth.y += (tilt.y - smooth.y) * 0.1;
        hero.style.setProperty('--px', smooth.x.toFixed(3));
        hero.style.setProperty('--py', smooth.y.toFixed(3));
        hero.style.setProperty('--sp', clamp(y / heroHeight, 0, 1).toFixed(3));

        // continua suavizando até chegar no alvo
        if (Math.abs(tilt.x - smooth.x) > 0.002 || Math.abs(tilt.y - smooth.y) > 0.002) requestFrame();
    }

    function requestFrame() {
        if (!frameId) frameId = requestAnimationFrame(frame);
    }

    window.addEventListener('scroll', requestFrame, { passive: true });
    window.addEventListener('resize', requestFrame, { passive: true });

    if ('IntersectionObserver' in window) {
        new IntersectionObserver(([entry]) => {
            heroVisible = entry.isIntersecting;
            requestFrame();
        }).observe(hero);
    }

    if (!reduceMotion && finePointer) {
        hero.addEventListener('pointermove', (event) => {
            if (event.pointerType !== 'mouse') return;
            const rect = hero.getBoundingClientRect();
            tilt.x = clamp(((event.clientX - rect.left) / rect.width - 0.5) * 2, -1, 1);
            tilt.y = clamp(((event.clientY - rect.top) / rect.height - 0.5) * 2, -1, 1);
            requestFrame();
        });
        hero.addEventListener('pointerleave', () => {
            tilt.x = 0;
            tilt.y = 0;
            requestFrame();
        });
    }

    // Celular (Android): o emblema acompanha a inclinação do aparelho.
    // No iPhone isso exige um pedido de permissão, então fica de fora.
    const needsPermission = typeof window.DeviceOrientationEvent !== 'undefined'
        && typeof window.DeviceOrientationEvent.requestPermission === 'function';

    if (!reduceMotion && !finePointer && 'DeviceOrientationEvent' in window && !needsPermission) {
        let base = null;
        window.addEventListener('deviceorientation', (event) => {
            if (!heroVisible || event.beta === null || event.gamma === null) return;
            if (!base) base = { beta: event.beta, gamma: event.gamma };
            // a referência acompanha devagar a posição em que a pessoa segura o celular
            base.beta += (event.beta - base.beta) * 0.02;
            base.gamma += (event.gamma - base.gamma) * 0.02;
            tilt.x = clamp((event.gamma - base.gamma) / 18, -1, 1);
            tilt.y = clamp((event.beta - base.beta) / 18, -1, 1);
            requestFrame();
        }, { passive: true });
    }

    requestFrame();

    // =====================================================
    // 12. Celular: arrastar o pedido para baixo fecha a gaveta
    // =====================================================
    const sheetQuery = window.matchMedia('(max-width: 600px)');
    const drawerHead = drawer.querySelector('.drawer-head');
    let drag = null;

    drawerHead.addEventListener('pointerdown', (event) => {
        if (!sheetQuery.matches || !isCartOpen() || event.target.closest('button, a')) return;
        drag = { id: event.pointerId, startY: event.clientY, startT: performance.now(), dy: 0 };
        drawerHead.setPointerCapture(event.pointerId);
        drawer.classList.add('is-dragging');
    });

    drawerHead.addEventListener('pointermove', (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        drag.dy = Math.max(0, event.clientY - drag.startY);
        drawer.style.setProperty('--drag', `${drag.dy}px`);
        backdrop.style.opacity = String(1 - Math.min(drag.dy / 500, 0.7));
    });

    function endDrag(event) {
        if (!drag || event.pointerId !== drag.id) return;
        const { dy, startT } = drag;
        const velocity = dy / Math.max(1, performance.now() - startT);
        drag = null;
        drawer.classList.remove('is-dragging');
        drawer.style.removeProperty('--drag');
        backdrop.style.removeProperty('opacity');
        if (dy > 110 || (dy > 30 && velocity > 0.6)) closeCart();
    }

    drawerHead.addEventListener('pointerup', endDrag);
    drawerHead.addEventListener('pointercancel', endDrag);

    // =====================================================
    // 13. Quiz "Qual leitura é para você?"
    //     As recomendações usam só as descrições do próprio catálogo.
    // =====================================================
    const QUIZ = {
        inicio: {
            question: 'Sobre o que é a sua pergunta?',
            options: [
                { label: 'Amor e relacionamento', hint: 'sentimentos, intenções, futuro', glyph: 'g-enamorados', next: 'amor' },
                { label: 'Desconfiança na relação', hint: 'traição, mentiras, algo escondido', glyph: 'g-moon', result: 'templo-diabo' },
                { label: 'Uma dúvida pontual', hint: 'qualquer tema, uma pergunta', glyph: 'g-star', next: 'pontual' },
                { label: 'Vários assuntos', hint: 'olhar a vida com calma', glyph: 'g-world', next: 'consulta' },
            ],
        },
        amor: {
            question: 'O que você quer entender?',
            options: [
                { label: 'A relação como um todo', hint: 'pensamentos, sentimentos, intenções e futuro', glyph: 'g-sun', result: 'templo-afrodite' },
                { label: 'Uma pergunta específica', hint: 'uma resposta mais direta', glyph: 'g-star', next: 'pontual' },
            ],
        },
        pontual: {
            question: 'Como você quer a resposta?',
            options: [
                { label: 'Direta e objetiva', hint: 'para decidir rápido', glyph: 'g-star', result: 'pergunta-objetiva' },
                { label: 'Com análise e conselhos', hint: 'para entender a situação a fundo', glyph: 'g-scales', result: 'pergunta-aprofundada' },
            ],
        },
        consulta: {
            question: 'Quanto tempo você quer?',
            options: [
                { label: '30 minutos', hint: 'os temas principais', glyph: 'g-star', result: 'leitura-30min' },
                { label: '1 hora', hint: 'um mergulho no momento atual', glyph: 'g-sun', result: 'leitura-1h' },
                { label: '2 horas', hint: 'vários temas, com calma', glyph: 'g-world', result: 'leitura-2h' },
            ],
        },
    };

    const QUIZ_RESULTS = {
        'pergunta-objetiva': { glyph: 'g-star', why: 'Para uma questão pontual, com resposta clara e direta.' },
        'pergunta-aprofundada': { glyph: 'g-scales', why: 'Análise detalhada de uma situação específica, com conselhos.' },
        'leitura-30min': { glyph: 'g-star', why: 'Tempo livre para abordar os temas que você precisar.' },
        'leitura-1h': { glyph: 'g-sun', why: 'Uma sessão completa para mergulhar no seu momento atual.' },
        'leitura-2h': { glyph: 'g-world', why: 'A consulta mais completa, para vários temas com calma.' },
        'templo-afrodite': { glyph: 'g-enamorados', why: 'Leitura para questões amorosas, autoestima e conexões afetivas: olha pensamentos, sentimentos, intenções e o futuro da relação.' },
        'templo-diabo': { glyph: 'g-diabo', why: 'Tiragem profunda para relações intensas e dinâmicas ocultas: investiga apego, mentiras, desejos e padrões que podem estar prendendo você.' },
    };

    const SVG_NS = 'http://www.w3.org/2000/svg';
    function svgIcon(id) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS(SVG_NS, 'use');
        use.setAttribute('href', `#${id}`);
        svg.append(use);
        return svg;
    }

    function make(tag, className, text) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    }

    // Leva até o item no catálogo e dá um brilho nele
    function goToProduct(id) {
        const btn = document.querySelector(`[data-add][data-name][data-id="${id}"]`);
        if (!btn) return;
        const spread = btn.closest('.spread');
        const target = btn.closest('.price-row') || (spread && spread.querySelector('.board-card')) || btn.closest('.product') || btn;
        target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        setTimeout(() => {
            target.classList.remove('is-highlight');
            void target.offsetWidth;
            target.classList.add('is-highlight');
        }, reduceMotion ? 0 : 450);
    }

    const quiz = document.querySelector('[data-quiz]');
    if (quiz) {
        const stage = quiz.querySelector('[data-quiz-stage]');
        const dots = [...quiz.querySelectorAll('[data-quiz-progress] span')];
        let current = 'inicio';
        let history = [];

        const setProgress = (index) => dots.forEach((dot, i) => {
            dot.classList.toggle('is-done', i < index);
            dot.classList.toggle('is-current', i === index);
        });

        function keepInView() {
            const top = quiz.getBoundingClientRect().top;
            if (top < header.offsetHeight || top > window.innerHeight * 0.6) {
                quiz.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
            }
        }

        function swap(node, focusEl, interactive) {
            const old = stage.firstElementChild;
            const put = () => {
                stage.replaceChildren(node);
                if (interactive) {
                    focusEl.focus({ preventScroll: true });
                    keepInView();
                }
            };
            if (interactive && old && old.classList.contains('quiz-step') && !reduceMotion) {
                old.classList.add('is-leaving');
                setTimeout(put, 200);
            } else {
                put();
            }
        }

        function navRow(withRestart) {
            const nav = make('div', 'quiz-nav');
            if (history.length) {
                const back = make('button', 'quiz-link quiz-link--back');
                back.type = 'button';
                back.append(svgIcon('i-arrow'), document.createTextNode('Voltar'));
                back.addEventListener('click', () => {
                    current = history.pop();
                    renderStep(current, true);
                });
                nav.append(back);
            }
            if (withRestart) {
                const restart = make('button', 'quiz-link');
                restart.type = 'button';
                restart.append(svgIcon('i-shuffle'), document.createTextNode('Refazer'));
                restart.addEventListener('click', () => {
                    history = [];
                    current = 'inicio';
                    renderStep(current, true);
                });
                nav.append(restart);
            }
            return nav;
        }

        function choose(button, option) {
            stage.querySelectorAll('.quiz-option').forEach((b) => { b.disabled = true; });
            button.classList.add('is-picked');
            haptic(10);
            setTimeout(() => {
                history.push(current);
                if (option.result) {
                    renderResult(option.result);
                } else {
                    current = option.next;
                    renderStep(current, true);
                }
            }, reduceMotion ? 0 : 170);
        }

        function renderStep(key, interactive) {
            const step = QUIZ[key];
            const node = make('div', 'quiz-step');
            const heading = make('h3', 'quiz-q', step.question);
            heading.tabIndex = -1;
            const list = make('div', `quiz-options${step.options.length === 3 ? ' quiz-options--3' : ''}`);
            step.options.forEach((option) => {
                const button = make('button', 'quiz-option');
                button.type = 'button';
                const glyph = make('span', 'quiz-option-glyph');
                glyph.append(svgIcon(option.glyph));
                const words = make('span');
                words.append(make('span', 'quiz-option-label', option.label), make('span', 'quiz-option-hint', option.hint));
                button.append(glyph, words);
                button.addEventListener('click', () => choose(button, option));
                list.append(button);
            });
            node.append(make('p', 'quiz-step-label', `Pergunta ${history.length + 1}`), heading, list);
            if (history.length) node.append(navRow(false));
            setProgress(history.length);
            swap(node, heading, interactive);
        }

        function renderResult(id) {
            const product = catalog.get(id);
            const result = QUIZ_RESULTS[id];
            const node = make('div', 'quiz-step');
            const box = make('div', 'quiz-result');

            // A recomendação aparece como uma carta que vira
            const card = make('div', 'quiz-card');
            const inner = make('div', 'quiz-card-inner');
            const front = make('div', 'quiz-card-face quiz-card-front');
            front.append(svgIcon(result.glyph), make('span', 'quiz-card-name', product.name));
            const back = make('div', 'quiz-card-face quiz-card-back');
            back.append(svgIcon('card-back'));
            inner.append(front, back);
            card.append(inner);

            const body = make('div', 'quiz-result-body');
            const heading = make('h3', '', product.name);
            heading.tabIndex = -1;
            const price = make('p', 'price-tag');
            price.append(make('small', '', 'R$'), document.createTextNode(String(product.price)));

            const rush = make('p', 'quiz-rush');
            rush.append('Com pressa? No pedido, marque ', make('strong', '', 'Furar fila'), ` (+ ${shortPrice(RUSH.price)}) e seja atendido na hora.`);

            const actions = make('div', 'quiz-actions');
            const add = make('button', 'btn btn-gold btn-shine');
            add.type = 'button';
            add.dataset.add = '';
            add.dataset.id = id;
            add.setAttribute('aria-label', `Adicionar ${product.name} ao pedido`);
            add.append(svgIcon('i-plus'), make('span', '', 'Adicionar ao pedido'));
            const see = make('button', 'btn btn-ghost', 'Ver no catálogo');
            see.type = 'button';
            see.addEventListener('click', () => goToProduct(id));
            actions.append(add, see);

            body.append(make('p', 'quiz-step-label', 'A leitura para você'), heading, price, make('p', 'quiz-why', result.why), rush, actions);
            box.append(card, body);
            node.append(box, navRow(true));
            setProgress(2);
            swap(node, heading, true);
            setTimeout(() => burst(card, { count: 9, distance: 60, className: 'spark spark--center' }), reduceMotion ? 0 : 1100);
        }

        renderStep(current, false);
    }

    // =====================================================
    // 14. Catálogo: barra de categorias que acompanha a rolagem
    // =====================================================
    const catbar = document.querySelector('[data-catbar]');
    if (catbar && 'IntersectionObserver' in window) {
        const track = catbar.querySelector('[data-catbar-track]');
        const chips = [...track.querySelectorAll('a')];
        const targets = chips.map((chip) => document.querySelector(chip.getAttribute('href')));
        const visible = new Map();
        let active = null;

        const setActive = (chip) => {
            if (chip === active) return;
            active = chip;
            chips.forEach((c) => {
                c.classList.toggle('is-active', c === chip);
                if (c === chip) c.setAttribute('aria-current', 'true');
                else c.removeAttribute('aria-current');
            });
            if (chip) {
                track.scrollTo({
                    left: chip.offsetLeft - (track.clientWidth - chip.offsetWidth) / 2,
                    behavior: reduceMotion ? 'auto' : 'smooth',
                });
            }
        };

        const spy = new IntersectionObserver((entries) => {
            entries.forEach((entry) => visible.set(entry.target, entry.isIntersecting));
            const first = targets.findIndex((target) => visible.get(target));
            if (first !== -1) setActive(chips[first]);
        }, { rootMargin: '-150px 0px -50% 0px' });
        targets.forEach((target) => { if (target) spy.observe(target); });
        chips.forEach((chip) => chip.addEventListener('click', () => setActive(chip)));
    }

    // =====================================================
    // 15. Carta do dia: tocar no emblema embaralha e revela uma carta
    //     A mesma pessoa vê a mesma carta durante o dia.
    // =====================================================
    const SALT_KEY = 'noctun:carta';
    const oracle = document.getElementById('carta-do-dia');
    const oracleBackdrop = document.querySelector('.oracle-backdrop');
    const shuffleBtn = document.querySelector('[data-shuffle]');
    let oracleReturn = null;
    let oracleTimers = [];

    const isOracleOpen = () => oracle.classList.contains('is-open');

    function dailyArcanum() {
        const now = new Date();
        const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
        let salt = 'noctun';
        try {
            salt = localStorage.getItem(SALT_KEY) || '';
            if (!salt) {
                salt = Math.random().toString(36).slice(2, 10);
                localStorage.setItem(SALT_KEY, salt);
            }
        } catch {
            salt = 'noctun';
        }
        let hash = 2166136261;
        for (const ch of day + salt) {
            hash ^= ch.codePointAt(0);
            hash = Math.imul(hash, 16777619);
        }
        return ARCANA[(hash >>> 0) % ARCANA.length];
    }

    function openOracle() {
        if (isOracleOpen()) return;
        const arcanum = dailyArcanum();
        oracle.querySelector('[data-oracle-num]').textContent = arcanum.num;
        oracle.querySelector('[data-oracle-glyph]').setAttribute('href', `#${arcanum.glyph}`);
        oracle.querySelector('[data-oracle-card-name]').textContent = arcanum.name;
        oracle.querySelector('[data-oracle-name]').textContent = arcanum.name;
        oracle.querySelector('[data-oracle-meaning]').textContent = arcanum.meaning;
        const keyList = oracle.querySelector('[data-oracle-keys]');
        keyList.replaceChildren(...arcanum.keys.map((key) => make('li', '', key)));

        oracleReturn = document.activeElement;
        setMenu(false);
        toastRegion.replaceChildren();
        oracle.inert = false;
        oracle.classList.add('is-open');
        oracleBackdrop.classList.add('is-open');
        pageRegions.forEach((el) => { el.inert = true; });
        document.body.classList.add('no-scroll');
        oracle.querySelector('.oracle-close').focus({ preventScroll: true });

        oracleTimers.forEach(clearTimeout);
        oracleTimers = [
            setTimeout(() => oracle.classList.add('is-revealed'), reduceMotion ? 0 : 450),
            setTimeout(() => burst(oracle.querySelector('[data-oracle-card]'), { count: 12, distance: 80, className: 'spark spark--center' }), 1000),
        ];
    }

    function closeOracle({ restoreFocus = true } = {}) {
        if (!isOracleOpen()) return;
        oracleTimers.forEach(clearTimeout);
        oracle.classList.remove('is-open', 'is-revealed');
        oracleBackdrop.classList.remove('is-open');
        oracle.inert = true;
        pageRegions.forEach((el) => { el.inert = false; });
        document.body.classList.remove('no-scroll');
        if (restoreFocus && oracleReturn && document.contains(oracleReturn)) oracleReturn.focus({ preventScroll: true });
    }

    if (shuffleBtn) {
        const art = shuffleBtn.closest('.hero-art');
        let shuffleTimer = 0;
        shuffleBtn.addEventListener('click', () => {
            art.classList.add('has-shuffled');
            art.classList.remove('is-shuffling');
            void art.offsetWidth;
            art.classList.add('is-shuffling');
            burst(art, { count: 10, distance: 90, className: 'spark spark--center' });
            haptic(14);
            clearTimeout(shuffleTimer);
            shuffleTimer = setTimeout(() => art.classList.remove('is-shuffling'), 1050);
            setTimeout(openOracle, reduceMotion ? 0 : 750);
        });
    }

    // =====================================================
    // 16. Lua de hoje (fase calculada; desenho como visto no Brasil)
    // =====================================================
    const moonBadge = document.querySelector('[data-moon]');
    if (moonBadge) {
        const SYNODIC = 29.530588853;
        const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
        const days = (Date.now() - KNOWN_NEW_MOON) / 86400000;
        const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
        // Como nos calendários brasileiros: cada fase vale ~7 dias a partir da data da fase
        const names = ['Lua Nova', 'Lua Crescente', 'Lua Cheia', 'Lua Minguante'];
        moonBadge.querySelector('[data-moon-name]').textContent = names[Math.floor(age / (SYNODIC / 4)) % 4];

        // Parte iluminada: no hemisfério sul, a lua crescente aparece iluminada à esquerda
        const r = 9;
        const k = Math.cos((2 * Math.PI * age) / SYNODIC);
        const litLeft = age < SYNODIC / 2;
        const rx = (Math.abs(k) * r).toFixed(2);
        const outer = litLeft ? 0 : 1;
        const inner = (k > 0) === litLeft ? 1 : 0;
        moonBadge.querySelector('[data-moon-lit]').setAttribute('d', `M12 3A${r} ${r} 0 0 ${outer} 12 21A${rx} ${r} 0 0 ${inner} 12 3Z`);
        moonBadge.hidden = false;
    }

    // =====================================================
    // 17. Poeira estelar: rastro do mouse e estrelas no toque
    // =====================================================
    if (!reduceMotion && document.body.animate) {
        let alive = 0;
        let last = 0;
        const spawn = (x, y, dx, dy, size, life) => {
            if (alive > 22) return;
            alive += 1;
            const el = document.createElement('span');
            el.className = 'stardust';
            el.innerHTML = '<svg aria-hidden="true"><use href="#twinkle"/></svg>';
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
            document.body.append(el);
            el.animate([
                { transform: `translate(0, 0) scale(${size}) rotate(0deg)`, opacity: 0.95 },
                { transform: `translate(${dx}px, ${dy}px) scale(0) rotate(120deg)`, opacity: 0 },
            ], { duration: life, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' }).onfinish = () => {
                el.remove();
                alive -= 1;
            };
        };

        if (finePointer) {
            window.addEventListener('pointermove', (event) => {
                if (event.pointerType !== 'mouse') return;
                const now = performance.now();
                if (now - last < 50) return;
                last = now;
                spawn(event.clientX, event.clientY, (Math.random() - 0.5) * 18, 14 + Math.random() * 18, 0.5 + Math.random() * 0.6, 700);
            }, { passive: true });
        } else {
            // No celular: um punhado de estrelas onde a pessoa toca
            document.addEventListener('click', (event) => {
                if (!event.clientX && !event.clientY) return; // clique via teclado
                for (let i = 0; i < 6; i += 1) {
                    const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.5;
                    const dist = 22 + Math.random() * 18;
                    spawn(event.clientX, event.clientY, Math.cos(angle) * dist, Math.sin(angle) * dist, 0.6 + Math.random() * 0.5, 650);
                }
            });
        }
    }

    document.querySelectorAll('[data-year]').forEach((el) => {
        el.textContent = String(new Date().getFullYear());
    });

    render();
    document.documentElement.dataset.ready = '';
})();

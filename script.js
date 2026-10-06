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
    // 10. Tiragens interativas: toque para virar as cartas
    // =====================================================
    function sparkle(card) {
        if (reduceMotion || !card.animate) return;
        const slot = card.closest('.slot');
        const total = 7;
        for (let i = 0; i < total; i += 1) {
            const el = document.createElement('span');
            el.className = 'spark';
            el.innerHTML = '<svg aria-hidden="true"><use href="#twinkle"/></svg>';
            slot.append(el);
            const angle = (Math.PI * 2 * i) / total + Math.random() * 0.6;
            const dist = 40 + Math.random() * 32;
            el.animate([
                { transform: 'translate(0, 0) scale(0) rotate(0deg)', opacity: 1 },
                { transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) scale(${0.5 + Math.random() * 0.7}) rotate(90deg)`, opacity: 0 },
            ], { duration: 750 + Math.random() * 300, delay: 220, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'both' })
                .onfinish = () => el.remove();
        }
    }

    function setupBoard(board) {
        const cards = [...board.querySelectorAll('[data-card]')];
        const wrap = board.closest('.board-card');
        const info = wrap.querySelector('[data-board-info]');
        const kicker = info.querySelector('[data-info-kicker]');
        const title = info.querySelector('[data-info-title]');
        const text = info.querySelector('[data-info-text]');
        const count = wrap.querySelector('[data-count]');
        const allBtn = wrap.querySelector('[data-reveal-all]');
        const questions = board.dataset.questions ? document.getElementById(board.dataset.questions) : null;
        const defaults = [kicker.textContent, title.textContent, text.textContent];

        const isFlipped = (card) => card.classList.contains('is-flipped');
        const details = (card) => ({
            pos: card.dataset.pos,
            text: card.dataset.text,
            num: card.querySelector('.tcard-num').textContent,
            name: card.querySelector('.tcard-name').textContent,
        });

        function label(card) {
            const { pos, name, num } = details(card);
            card.setAttribute('aria-label', isFlipped(card)
                ? `${pos}: ${name} (${num}). Toque para virar de volta.`
                : `${pos}: carta virada para baixo. Toque para revelar.`);
        }

        function showInfo(k, t, x) {
            kicker.textContent = k;
            title.textContent = t;
            text.textContent = x;
            info.classList.remove('is-updating');
            void info.offsetWidth; // reinicia a animação do texto
            info.classList.add('is-updating');
        }

        function showCard(card) {
            const { pos, text: question, name, num } = details(card);
            showInfo(pos, question, `Carta ilustrativa: ${name} (${num})`);
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
            allBtn.querySelector('span').textContent = all ? 'Embaralhar' : 'Revelar todas';
            allBtn.querySelector('use').setAttribute('href', all ? '#i-shuffle' : '#i-eye');
        }

        function toggle(card) {
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

        function shuffle() {
            board.classList.add('is-shuffling');
            cards.forEach((card) => {
                card.classList.remove('is-flipped');
                label(card);
            });
            setCurrent(null);
            showInfo(...defaults);
            update();
            setTimeout(() => board.classList.remove('is-shuffling'), 1100);
        }

        cards.forEach((card) => {
            label(card);
            card.addEventListener('click', () => {
                toggle(card);
                haptic(isFlipped(card) ? 14 : 8);
            });
        });

        allBtn.addEventListener('click', () => {
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
                    if (event.pointerType !== 'mouse' || !rect) return;
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

        board.classList.add('is-interactive');
        update();
    }

    document.querySelectorAll('[data-board]').forEach(setupBoard);

    // =====================================================
    // 11. Hero com profundidade + barra de progresso
    //     Um único laço requestAnimationFrame para scroll,
    //     mouse e inclinação do celular.
    // =====================================================
    const hero = document.querySelector('.hero');
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

        header.classList.toggle('is-scrolled', y > 8);
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

    document.querySelectorAll('[data-year]').forEach((el) => {
        el.textContent = String(new Date().getFullYear());
    });

    render();
    document.documentElement.dataset.ready = '';
})();

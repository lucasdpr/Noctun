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
    const BIRTH_KEY = 'noctun:nascimento'; // data informada em "Seu arcano" (só neste aparelho)
    // Pergunta escrita pela pessoa: só nesta aba (sessionStorage), some ao fechar o navegador
    const QUESTION_KEY = 'noctun:pergunta';
    const QUESTION_MAX = 400;
    const MAX_QTY = 20;

    const waUrl = (text) => `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;

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
    //    data-kind="produto" → vela/banho; sem ele → leitura
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
    // "Furar fila" vale para a fila de leituras: só conta se houver leitura no pedido
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

    // Pergunta da pessoa: { text, topic }. Sem armazenamento, fica só na memória.
    let questionMemory = null;

    function cleanQuestion(data) {
        if (!data || typeof data.text !== 'string') return null;
        const text = data.text.slice(0, QUESTION_MAX);
        if (!text.trim()) return null;
        return { text, topic: typeof data.topic === 'string' ? data.topic : '' };
    }

    function getQuestion() {
        try {
            const raw = sessionStorage.getItem(QUESTION_KEY);
            return raw === null ? questionMemory : cleanQuestion(JSON.parse(raw));
        } catch {
            return questionMemory;
        }
    }

    function setQuestion(data) {
        questionMemory = cleanQuestion(data);
        try {
            if (questionMemory) sessionStorage.setItem(QUESTION_KEY, JSON.stringify(questionMemory));
            else sessionStorage.removeItem(QUESTION_KEY);
        } catch {
            // sem sessionStorage: segue na memória
        }
    }

    const clearQuestion = () => setQuestion(null);

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
        question: document.querySelector('[data-cart-question]'),
        continueBtn: document.querySelector('[data-cart-continue]'),
        live: document.querySelector('[data-cart-live]'),
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
        ui.continueBtn.hidden = !hasItems;

        renderList(items);
        renderQuestion();
        updateCheckoutLinks();
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

    // Diálogos que travam a página (pedido, carta do dia, ritual). A página só
    // volta ao normal quando nenhum deles continua aberto.
    const modalChecks = [isCartOpen];
    const anyModalOpen = () => modalChecks.some((isOpen) => isOpen());

    function lockPage() {
        pageRegions.forEach((el) => { el.inert = true; });
        document.body.classList.add('no-scroll');
    }

    function unlockPage() {
        if (anyModalOpen()) return;
        pageRegions.forEach((el) => { el.inert = false; });
        document.body.classList.remove('no-scroll');
    }

    function announce(message) {
        ui.live.textContent = '';
        setTimeout(() => { ui.live.textContent = message; }, 60);
    }

    // highlight: chave do item que acabou de entrar (brilha por um instante)
    function openCart({ returnFocus = null, highlight = null } = {}) {
        if (anyModalOpen() && !isCartOpen()) return;
        if (!isCartOpen()) {
            lastFocus = returnFocus || document.activeElement;
            setMenu(false);
            toastRegion.replaceChildren(); // avisos ficariam por cima do cabeçalho da gaveta

            drawer.inert = false;
            drawer.classList.add('is-open');
            backdrop.classList.add('is-open');
            // Torna o resto da página inerte: o foco fica preso dentro do pedido
            lockPage();
            closeBtn.focus({ preventScroll: true });
        }
        if (highlight) {
            const li = ui.list.querySelector(`[data-key="${CSS.escape(highlight)}"]`);
            if (li) {
                li.classList.remove('is-new');
                void li.offsetWidth;
                li.classList.add('is-new');
                setTimeout(() => li.classList.remove('is-new'), 1400);
                // com o bloco da pergunta (fica no topo), mostra o começo do pedido
                if (!ui.question.hidden) drawer.querySelector('.drawer-body').scrollTop = 0;
                else li.scrollIntoView({ block: 'nearest' });
                const name = li.querySelector('.cart-item-name').textContent;
                announce(`${name} está no seu pedido.`);
            }
        }
    }

    function closeCart({ restoreFocus = true } = {}) {
        if (!isCartOpen()) return;
        drawer.classList.remove('is-open');
        backdrop.classList.remove('is-open');
        drawer.inert = true;
        setSent(false);
        closeQuestionEditor({ focus: false });
        unlockPage();

        if (restoreFocus) {
            const canFocus = lastFocus && document.contains(lastFocus) && lastFocus.getClientRects().length > 0;
            (canFocus ? lastFocus : ui.cartBtn).focus({ preventScroll: true });
        }
    }

    // ---------- Pergunta dentro do pedido ----------
    const cq = {
        filled: ui.question.querySelector('[data-cq-filled]'),
        text: ui.question.querySelector('[data-cq-text]'),
        edit: ui.question.querySelector('[data-cq-edit]'),
        clear: ui.question.querySelector('[data-cq-clear]'),
        add: ui.question.querySelector('[data-cq-add]'),
        editor: ui.question.querySelector('[data-cq-editor]'),
        input: ui.question.querySelector('[data-cq-input]'),
        done: ui.question.querySelector('[data-cq-done]'),
    };
    let questionSaveTimer = 0;

    function renderQuestion() {
        // Só faz sentido para leituras; velas e banhos não levam pergunta
        ui.question.hidden = !hasService();
        if (!cq.editor.hidden) return; // não mexe enquanto a pessoa escreve
        const question = getQuestion();
        cq.filled.hidden = !question;
        cq.add.hidden = Boolean(question);
        cq.text.textContent = question ? `“${question.text.trim()}”` : '';
    }

    function openQuestionEditor() {
        const question = getQuestion();
        cq.input.value = question ? question.text : '';
        cq.editor.hidden = false;
        cq.filled.hidden = true;
        cq.add.hidden = true;
        [cq.edit, cq.add].forEach((btn) => btn.setAttribute('aria-expanded', 'true'));
        cq.input.focus();
        cq.input.setSelectionRange(cq.input.value.length, cq.input.value.length);
    }

    function saveQuestionInput() {
        clearTimeout(questionSaveTimer);
        const previous = getQuestion();
        setQuestion({ text: cq.input.value, topic: previous ? previous.topic : '' });
        updateCheckoutLinks();
    }

    function closeQuestionEditor({ focus = true } = {}) {
        if (cq.editor.hidden) return;
        saveQuestionInput();
        cq.editor.hidden = true;
        [cq.edit, cq.add].forEach((btn) => btn.setAttribute('aria-expanded', 'false'));
        renderQuestion();
        if (focus) (getQuestion() ? cq.edit : cq.add).focus();
    }

    cq.add.addEventListener('click', openQuestionEditor);
    cq.edit.addEventListener('click', openQuestionEditor);
    cq.done.addEventListener('click', () => closeQuestionEditor());
    cq.input.addEventListener('input', () => {
        clearTimeout(questionSaveTimer);
        questionSaveTimer = setTimeout(saveQuestionInput, 300);
    });
    cq.clear.addEventListener('click', () => {
        clearQuestion();
        renderQuestion();
        updateCheckoutLinks();
        cq.add.focus();
        announce('Pergunta apagada.');
    });

    // ---------- Pedido preparado (depois de tocar em Finalizar) ----------
    const sent = {
        box: drawer.querySelector('[data-sent]'),
        title: drawer.querySelector('[data-sent-title]'),
        open: drawer.querySelector('[data-sent-open]'),
        copy: drawer.querySelector('[data-sent-copy]'),
        copied: drawer.querySelector('[data-sent-copied]'),
        last: drawer.querySelector('[data-sent-last]'),
    };

    function setSent(on) {
        if (on && !isCartOpen()) return; // a pessoa fechou o pedido antes: nada a mostrar
        drawer.classList.toggle('is-sent', on);
        sent.box.hidden = !on;
        sent.copied.textContent = '';
        if (!on) return;
        sent.last.textContent = !hasService()
            ? 'A entrega das velas e banhos é combinada por lá.'
            : rushActive()
                ? 'Com Furar fila, você é atendido na hora.'
                : 'Após o comprovante, sua leitura entra na fila e chega em até 3 dias corridos.';
        updateCheckoutLinks();
        sent.title.focus({ preventScroll: true });
        drawer.querySelector('.drawer-body').scrollTop = 0;
        if (!reduceMotion) burst(sent.box.querySelector('.seal'), { count: 9, distance: 50, className: 'spark spark--center' });
    }

    function updateCheckoutLinks() {
        if (!state.items.length) return;
        const url = waUrl(buildMessage());
        ui.checkout.href = url;
        sent.open.href = url;
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Navegadores sem a API de área de transferência
            const area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            const previous = document.activeElement;
            drawer.append(area);
            area.select();
            let ok = false;
            try {
                ok = document.execCommand('copy');
            } catch {
                ok = false;
            }
            area.remove();
            if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
            return ok;
        }
    }

    sent.copy.addEventListener('click', async () => {
        const ok = await copyText(buildMessage());
        sent.copied.textContent = ok
            ? 'Mensagem copiada. Cole na conversa com o Guilherme: (24) 99989-4376.'
            : 'Não deu para copiar aqui. Use “Abrir o WhatsApp de novo”.';
    });

    drawer.querySelector('[data-sent-back]').addEventListener('click', () => {
        setSent(false);
        closeBtn.focus();
    });

    drawer.querySelector('[data-sent-clear]').addEventListener('click', () => {
        cq.input.value = '';
        closeQuestionEditor({ focus: false });
        state.items = [];
        state.rush = false;
        clearQuestion();
        commit();
        closeCart();
        toast('Pedido limpo.');
    });

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
            lines.push('*Leituras:*', ...services.map(line), ...rushLine, '', '*Velas e banhos:*', ...products.map(line));
        } else {
            lines.push(...items.map(line), ...rushLine);
        }
        lines.push('', `*Total: ${variable ? 'a partir de ' : ''}${formatBRL(orderTotal())}*`);
        if (variable) lines.push('_O valor das velas pode variar conforme a cor e a essência._');

        // A pergunta escrita no site já vai pronta (só para leituras)
        const question = services.length ? getQuestion() : null;
        if (question) lines.push('', '*Minha pergunta:*', `“${question.text.replace(/\s+/g, ' ').trim()}”`);

        // Pede só os dados que fazem sentido para o que foi pedido
        lines.push('', '*Meus dados:*', 'Nome completo: ');
        if (services.length) lines.push(`Data de nascimento: ${savedBirth()}`, 'Contexto da história: ');
        if (products.length) lines.push('Cidade/bairro (para combinarmos a entrega): ');
        return lines.join('\n');
    }

    // "Finalizar" é um link de verdade para o WhatsApp (mais confiável nos navegadores
    // do Instagram/TikTok do que window.open). O endereço é atualizado a cada mudança.
    function checkout(event) {
        if (!state.items.length) {
            event.preventDefault();
            toast('Adicione uma leitura ao pedido primeiro.');
            return;
        }
        closeQuestionEditor({ focus: false }); // salva o que estiver sendo escrito
        updateCheckoutLinks();
        setTimeout(() => setSent(true), 0);
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
            // Botões de impulso (tiragens, resultado do quiz): abrem o pedido na hora,
            // sem duplicar o item se a pessoa tocar de novo
            if (addBtn.dataset.then === 'pedido') {
                const key = itemKey(id, opts);
                if (!findItem(key)) {
                    addItem(id, opts);
                    flashAdded(addBtn);
                    haptic();
                }
                setTimeout(() => openCart({ returnFocus: addBtn, highlight: key }), reduceMotion ? 0 : 450);
                return;
            }
            addItem(id, opts);
            flashAdded(addBtn);
            flyToCart(addBtn);
            haptic();
            toast(`Adicionado ao pedido: ${product.name}${opts ? ` (${Object.values(opts).join(', ')})` : ''}`);
            return;
        }

        const ritualOpener = event.target.closest('[data-ritual-open]');
        if (ritualOpener) {
            event.preventDefault();
            openRitual(ritualOpener);
            return;
        }

        if (event.target.closest('[data-ritual-close]')) {
            closeRitual();
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
            checkout(event);
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
        if (isRitualOpen()) closeRitual();
        else if (isOracleOpen()) closeOracle();
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
        // O que já aparece na primeira tela (o topo inteiro, ou a seção de um link
        // como #metodos) entra na hora: nada de botões invisíveis na dobra
        revealEls.forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (el.closest('.hero') || (rect.top < window.innerHeight && rect.bottom > 0)) el.classList.add('is-visible');
        });
        const revealer = new IntersectionObserver((entries, observer) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
        revealEls.forEach((el) => { if (!el.classList.contains('is-visible')) revealer.observe(el); });
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
                // volta para a última carta que continua aberta; sem nenhuma, mostra a instrução inicial
                const still = cards.filter(isFlipped).pop();
                setCurrent(still || null);
                if (still) showCard(still);
                else showInfo(...defaults);
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
    document.querySelectorAll('[data-cta]').forEach((btn) => labelCta(btn));


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
                // o passo que está saindo não aceita mais cliques (evita voltar duas vezes)
                old.querySelectorAll('button').forEach((b) => { b.disabled = true; });
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
                    if (!history.length) return;
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
            // trava o passo inteiro (opções e Voltar) até a próxima tela entrar
            stage.querySelectorAll('button').forEach((b) => { b.disabled = true; });
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
            add.dataset.then = 'pedido';
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

        // Depois de um clique, o chip escolhido fica travado até a rolagem terminar
        let locked = false;
        let unlockTimer = 0;
        const unlockLater = (ms) => {
            clearTimeout(unlockTimer);
            unlockTimer = setTimeout(() => { locked = false; }, ms);
        };
        window.addEventListener('scroll', () => { if (locked) unlockLater(160); }, { passive: true });

        const spy = new IntersectionObserver((entries) => {
            entries.forEach((entry) => visible.set(entry.target, entry.isIntersecting));
            if (locked) return;
            // Mantém o chip atual enquanto a seção dele estiver na faixa: no desktop,
            // "Perguntas" e "Consultas" ficam lado a lado e entram na faixa juntas
            const current = chips.indexOf(active);
            if (current !== -1 && visible.get(targets[current])) return;
            const first = targets.findIndex((target) => visible.get(target));
            if (first !== -1) setActive(chips[first]);
        }, { rootMargin: '-150px 0px -50% 0px' });
        targets.forEach((target) => { if (target) spy.observe(target); });
        chips.forEach((chip) => chip.addEventListener('click', () => {
            locked = true;
            unlockLater(1000);
            setActive(chip);
        }));
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
    let oracleOpenTimer = 0;

    const isOracleOpen = () => oracle.classList.contains('is-open');
    modalChecks.push(isOracleOpen);

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
        // não abre por cima de outro diálogo (a pessoa pode ter aberto o pedido durante o embaralhar)
        if (anyModalOpen()) return;
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
        lockPage();
        oracle.querySelector('.oracle-close').focus({ preventScroll: true });

        oracleTimers.forEach(clearTimeout);
        oracleTimers = [
            setTimeout(() => oracle.classList.add('is-revealed'), reduceMotion ? 0 : 450),
            setTimeout(() => burst(oracle.querySelector('[data-oracle-card]'), { count: 12, distance: 80, className: 'spark spark--center' }), 1000),
        ];
    }

    function closeOracle({ restoreFocus = true } = {}) {
        clearTimeout(oracleOpenTimer);
        if (!isOracleOpen()) return;
        oracleTimers.forEach(clearTimeout);
        oracle.classList.remove('is-open', 'is-revealed');
        oracleBackdrop.classList.remove('is-open');
        oracle.inert = true;
        unlockPage();
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
            clearTimeout(oracleOpenTimer);
            oracleOpenTimer = setTimeout(openOracle, reduceMotion ? 0 : 750);
        });
    }

    // =====================================================
    // 16. Lua de hoje (fase calculada; desenho como visto no Brasil)
    // =====================================================
    // Instante de uma fase principal: Meeus, "Astronomical Algorithms", cap. 49
    // (termos periódicos principais; erro de poucos minutos).
    // lunation: lunações desde jan/2000; quarter: 0 nova, 1 quarto crescente, 2 cheia, 3 quarto minguante
    function moonPhaseTime(lunation, quarter) {
        const k = lunation + quarter / 4;
        const T = k / 1236.85;
        const rad = Math.PI / 180;
        const E = 1 - 0.002516 * T - 0.0000074 * T * T;
        const M = (2.5534 + 29.1053567 * k - 0.0000014 * T * T) * rad;
        const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T * T) * rad;
        const F = (160.7108 + 390.67050284 * k - 0.0016118 * T * T) * rad;
        const omega = (124.7746 - 1.56375588 * k + 0.0020672 * T * T) * rad;
        const { sin, cos } = Math;
        let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T - 0.00000015 * T ** 3 + 0.00000000073 * T ** 4;

        if (quarter % 2 === 0) {
            const c = quarter === 0
                ? [-0.40720, 0.17241, 0.01608, 0.01039, 0.00739, -0.00514, 0.00208]
                : [-0.40614, 0.17302, 0.01614, 0.01043, 0.00734, -0.00515, 0.00209];
            jde += c[0] * sin(Mp) + c[1] * E * sin(M) + c[2] * sin(2 * Mp) + c[3] * sin(2 * F)
                + c[4] * E * sin(Mp - M) + c[5] * E * sin(Mp + M) + c[6] * E * E * sin(2 * M)
                - 0.00111 * sin(Mp - 2 * F) - 0.00057 * sin(Mp + 2 * F) + 0.00056 * E * sin(2 * Mp + M)
                - 0.00042 * sin(3 * Mp) + 0.00042 * E * sin(M + 2 * F) + 0.00038 * E * sin(M - 2 * F)
                - 0.00024 * E * sin(2 * Mp - M) - 0.00017 * sin(omega);
        } else {
            jde += -0.62801 * sin(Mp) + 0.17172 * E * sin(M) - 0.01183 * E * sin(Mp + M) + 0.00862 * sin(2 * Mp)
                + 0.00804 * sin(2 * F) + 0.00454 * E * sin(Mp - M) + 0.00204 * E * E * sin(2 * M)
                - 0.00180 * sin(Mp - 2 * F) - 0.00070 * sin(Mp + 2 * F) - 0.00040 * sin(3 * Mp)
                - 0.00034 * E * sin(2 * Mp - M) + 0.00032 * E * sin(M + 2 * F) + 0.00032 * E * sin(M - 2 * F)
                - 0.00028 * E * E * sin(Mp + 2 * M) + 0.00027 * E * sin(2 * Mp + M) - 0.00017 * sin(omega);
            const W = 0.00306 - 0.00038 * E * cos(M) + 0.00026 * cos(Mp) - 0.00002 * cos(Mp - M)
                + 0.00002 * cos(Mp + M) + 0.00002 * cos(2 * F);
            jde += quarter === 1 ? W : -W;
        }
        return (jde - 2440587.5) * 86400000; // dia juliano → milissegundos (ΔT de ~1 min ignorado)
    }

    const moonBadge = document.querySelector('[data-moon]');
    if (moonBadge) {
        const now = Date.now();
        const endOfToday = new Date(now).setHours(23, 59, 59, 999);
        const near = Math.floor((now - Date.UTC(2000, 0, 6, 18, 14)) / (29.530588861 * 86400000));
        const events = [];
        for (let lunation = near - 1; lunation <= near + 1; lunation += 1) {
            for (let quarter = 0; quarter < 4; quarter += 1) events.push({ quarter, time: moonPhaseTime(lunation, quarter) });
        }
        // Como nos calendários brasileiros: a fase vale a partir do DIA em que acontece
        const current = events.filter((event) => event.time <= endOfToday).pop();
        const names = ['Lua Nova', 'Lua Crescente', 'Lua Cheia', 'Lua Minguante'];
        moonBadge.querySelector('[data-moon-name]').textContent = names[current.quarter];

        // Desenho pela posição real dentro da lunação (0 = nova, 0,5 = cheia)
        const newMoons = events.filter((event) => event.quarter === 0);
        const previous = newMoons.filter((event) => event.time <= now).pop();
        const next = newMoons.find((event) => event.time > now);
        const cycle = (now - previous.time) / (next.time - previous.time);

        // Parte iluminada: no hemisfério sul, a lua crescente aparece iluminada à esquerda
        const r = 9;
        const k = Math.cos(2 * Math.PI * cycle);
        const litLeft = cycle < 0.5;
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
                if (event.target.closest('textarea, input, select, label')) return; // não atrapalha quem escreve
                for (let i = 0; i < 6; i += 1) {
                    const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.5;
                    const dist = 22 + Math.random() * 18;
                    spawn(event.clientX, event.clientY, Math.cos(angle) * dist, Math.sin(angle) * dist, 0.6 + Math.random() * 0.5, 650);
                }
            });
        }
    }

    // =====================================================
    // 18. Compartilhar (menu nativo do celular ou WhatsApp)
    // =====================================================
    async function shareText(text, hash = '') {
        const url = `${location.origin}${location.pathname}${hash}`;
        if (navigator.share) {
            try {
                await navigator.share({ title: 'Noctun Tarot', text, url });
            } catch {
                // a pessoa cancelou o compartilhamento
            }
            return;
        }
        // Link criado e clicado no mesmo toque: funciona nos navegadores do Instagram/TikTok
        const link = document.createElement('a');
        link.href = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
        link.target = '_blank';
        link.rel = 'noopener';
        document.body.append(link);
        link.click();
        link.remove();
    }

    const oracleShare = document.querySelector('[data-share="oracle"]');
    if (oracleShare) {
        oracleShare.addEventListener('click', () => {
            const arcanum = dailyArcanum();
            shareText(`Minha carta do dia na Noctun Tarot é ${arcanum.name} (${arcanum.keys.join(', ')}) ✨ Tire a sua:`, '#tirar-carta');
        });
    }

    // Quem chega por um link compartilhado ganha um convite (sem abrir nada sozinho)
    const landing = location.hash;
    if (landing === '#tirar-carta' || landing === '#carta-do-dia') {
        history.replaceState(null, '', location.pathname + location.search);
        window.scrollTo(0, 0);
        const art = document.querySelector('.hero-art');
        const hint = art && art.querySelector('.arch-hint');
        if (art && hint) {
            art.classList.add('is-invited');
            hint.textContent = 'Sua vez: toque no emblema e tire sua carta do dia';
            art.querySelector('[data-shuffle]').addEventListener('click', () => art.classList.remove('is-invited'), { once: true });
        }
    } else if (landing === '#arcano') {
        const dateInput = document.querySelector('[data-arcano-input]');
        if (dateInput) {
            dateInput.classList.add('is-called');
            setTimeout(() => dateInput.classList.remove('is-called'), 2600);
        }
    }

    // =====================================================
    // 19. Seu arcano: data de nascimento → arcano de nascimento + carta do signo
    // =====================================================
    // Carta regente de cada signo (correspondência tradicional da Golden Dawn)
    const SIGNS = [
        { name: 'Capricórnio', from: 1222, arcanum: 15 },
        { name: 'Aquário', from: 120, arcanum: 17 },
        { name: 'Peixes', from: 219, arcanum: 18 },
        { name: 'Áries', from: 321, arcanum: 4 },
        { name: 'Touro', from: 420, arcanum: 5 },
        { name: 'Gêmeos', from: 521, arcanum: 6 },
        { name: 'Câncer', from: 621, arcanum: 7 },
        { name: 'Leão', from: 723, arcanum: 8 },
        { name: 'Virgem', from: 823, arcanum: 9 },
        { name: 'Libra', from: 923, arcanum: 11 },
        { name: 'Escorpião', from: 1023, arcanum: 13 },
        { name: 'Sagitário', from: 1122, arcanum: 14 },
    ];

    function signOf(day, month) {
        const value = month * 100 + day;
        if (value >= 1222 || value < 120) return SIGNS[0];
        return SIGNS.slice(1).filter((sign) => value >= sign.from).pop();
    }

    // Arcano de nascimento: soma dia + mês + ano e reduz os dígitos até chegar a 22 ou menos (22 = O Louco)
    function birthArcanum(day, month, year) {
        let n = day + month + year;
        while (n > 22) n = String(n).split('').reduce((sum, digit) => sum + Number(digit), 0);
        return n === 22 ? 0 : n;
    }

    function parseBirth(value) {
        const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value || '');
        if (!match) return null;
        const [day, month, year] = match.slice(1).map(Number);
        const date = new Date(year, month - 1, day);
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
        if (year < 1900 || date > new Date()) return null;
        return { day, month, year };
    }

    function birthError(value) {
        const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
        if (!match) return 'Use o formato dd/mm/aaaa (ex.: 23/07/1998).';
        const [day, month, year] = match.slice(1).map(Number);
        const date = new Date(year, month - 1, day);
        if (date.getMonth() !== month - 1 || date.getDate() !== day) return 'Essa data não existe no calendário. Confira o dia e o mês.';
        if (year < 1900) return 'Confira o ano de nascimento (ex.: 1998).';
        return 'Essa data ainda não chegou. Confira o ano.';
    }

    function savedBirth() {
        try {
            const value = localStorage.getItem(BIRTH_KEY);
            return parseBirth(value) ? value : '';
        } catch {
            return '';
        }
    }

    function labelCta(btn) {
        const product = catalog.get(btn.dataset.id);
        if (!product) return;
        btn.querySelector('span').textContent = `${btn.dataset.cta} · ${shortPrice(product.price)}`;
        btn.setAttribute('aria-label', `${btn.dataset.cta}: adicionar ${product.name} ao pedido por ${formatBRL(product.price)}`);
    }

    const arcanoForm = document.querySelector('[data-arcano-form]');
    if (arcanoForm) {
        const input = arcanoForm.querySelector('[data-arcano-input]');
        const error = arcanoForm.querySelector('[data-arcano-error]');
        const result = document.querySelector('[data-arcano-result]');
        const label = arcanoForm.querySelector('.arcano-label');
        const help = arcanoForm.querySelector('.arcano-help');
        const ownTexts = { label: label.textContent, help: help.textContent };
        // Consultar a data de outra pessoa não troca a data que vai no pedido
        let forOther = false;

        function setMode(other) {
            forOther = other;
            label.textContent = other ? 'Data de nascimento da outra pessoa' : ownTexts.label;
            help.textContent = other ? 'Essa consulta não muda a data que vai no seu pedido.' : ownTexts.help;
        }

        // Máscara dd/mm/aaaa enquanto digita, sem jogar o cursor para o fim ao corrigir no meio
        input.addEventListener('input', () => {
            const caret = input.selectionStart ?? input.value.length;
            const digitsBefore = input.value.slice(0, caret).replace(/\D/g, '').length;
            const digits = input.value.replace(/\D/g, '').slice(0, 8);
            const formatted = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('/');
            input.value = formatted;
            let pos = 0;
            for (let seen = 0; pos < formatted.length && seen < digitsBefore; pos += 1) {
                if (formatted[pos] !== '/') seen += 1;
            }
            if (document.activeElement === input) input.setSelectionRange(pos, pos);
            if (!error.hidden) {
                error.hidden = true;
                input.removeAttribute('aria-invalid');
            }
        });

        function pickBlock(tag, arcanum) {
            const block = make('div', 'arcano-pick');
            const card = make('div', 'quiz-card');
            const inner = make('div', 'quiz-card-inner');
            const front = make('div', 'quiz-card-face quiz-card-front');
            front.append(svgIcon(arcanum.glyph), make('span', 'quiz-card-name', arcanum.name));
            const back = make('div', 'quiz-card-face quiz-card-back');
            back.append(svgIcon('card-back'));
            inner.append(front, back);
            card.append(inner);
            const body = make('div');
            body.append(
                make('p', 'arcano-tag', tag),
                make('h3', 'arcano-name', arcanum.name),
                make('p', 'arcano-keys', arcanum.keys.join(' · ')),
                make('p', 'arcano-meaning', arcanum.meaning),
            );
            block.append(card, body);
            return block;
        }

        function reveal(birth, interactive) {
            const born = ARCANA[birthArcanum(birth.day, birth.month, birth.year)];
            const sign = signOf(birth.day, birth.month);
            const ruler = ARCANA[sign.arcanum];

            const cards = make('div', 'arcano-cards');
            if (born === ruler) {
                cards.classList.add('arcano-cards--single');
                cards.append(pickBlock(`Nascimento e signo de ${sign.name}`, born));
            } else {
                cards.append(pickBlock('Arcano de nascimento', born), pickBlock(`Carta do seu signo · ${sign.name}`, ruler));
            }

            const actions = make('div', 'arcano-actions');
            const ask = make('button', 'btn btn-gold btn-shine');
            ask.type = 'button';
            ask.dataset.ritualOpen = '';
            ask.append(svgIcon('twinkle'), make('span', '', 'Fazer minha pergunta'));

            const share = make('button', 'btn btn-ghost');
            share.type = 'button';
            share.append(svgIcon('i-share'), make('span', '', 'Compartilhar'));
            share.addEventListener('click', () => shareText(
                forOther
                    ? `Descobri o arcano de nascimento de alguém especial: ${born.name} ✨ Descubra o seu na Noctun Tarot:`
                    : `Meu arcano de nascimento é ${born.name}${born === ruler ? '' : ` e a carta do meu signo (${sign.name}) é ${ruler.name}`} ✨ Descubra o seu na Noctun Tarot:`,
                '#arcano',
            ));

            const again = make('button', 'quiz-link');
            again.type = 'button';
            again.append(svgIcon('i-shuffle'), document.createTextNode('Ver de outra pessoa'));
            again.addEventListener('click', () => {
                setMode(true);
                result.replaceChildren();
                input.value = '';
                input.focus();
            });
            actions.append(ask, share, again);

            const mine = savedBirth();
            if (forOther && mine) {
                const back = make('button', 'quiz-link quiz-link--back');
                back.type = 'button';
                back.append(svgIcon('i-arrow'), document.createTextNode('Minha data'));
                back.addEventListener('click', () => {
                    setMode(false);
                    input.value = mine;
                    reveal(parseBirth(mine), false);
                    input.focus();
                });
                actions.append(back);
            }
            result.replaceChildren(
                cards,
                actions,
                make('p', 'arcano-note', 'Significados gerais das cartas. Na leitura, o Guilherme relaciona o seu arcano com a sua pergunta.'),
            );

            if (interactive) {
                haptic(14);
                setTimeout(() => cards.querySelectorAll('.quiz-card').forEach((card) => burst(card, { count: 9, distance: 55, className: 'spark spark--center' })), reduceMotion ? 0 : 1000);
                if (result.getBoundingClientRect().bottom > window.innerHeight) {
                    cards.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
                }
            }
        }

        arcanoForm.addEventListener('submit', (event) => {
            event.preventDefault();
            const value = input.value.trim();
            const birth = parseBirth(value);
            if (!birth) {
                // tira da tela o resultado da data anterior para não parecer a resposta desta
                result.replaceChildren();
                error.textContent = birthError(value);
                error.hidden = false;
                input.setAttribute('aria-invalid', 'true');
                input.focus();
                haptic([18, 60, 18]);
                return;
            }
            if (!forOther) {
                try {
                    localStorage.setItem(BIRTH_KEY, value);
                } catch {
                    // sem armazenamento: o resultado aparece mesmo assim
                }
            }
            reveal(birth, true);
        });

        // Quem já informou a data vê o resultado direto (sem roubar o foco)
        const previous = savedBirth();
        if (previous) {
            input.value = previous;
            reveal(parseBirth(previous), false);
        }
    }

    document.querySelectorAll('[data-year]').forEach((el) => {
        el.textContent = String(new Date().getFullYear());
    });

    // =====================================================
    // 20. Ritual da pergunta: acender a vela, escrever e selar a pergunta,
    //     escolher o formato e seguir para o pedido.
    //     Aqui o site não sorteia nem lê cartas: a pergunta vai para o Guilherme.
    // =====================================================
    const ritual = document.getElementById('ritual');
    const ritualBackdrop = document.querySelector('.ritual-backdrop');
    const ritualStage = ritual.querySelector('[data-ritual-stage]');
    const isRitualOpen = () => ritual.classList.contains('is-open');
    modalChecks.push(isRitualOpen);

    const TOPICS = [
        { id: 'amor', label: 'Amor' },
        { id: 'desconfianca', label: 'Desconfiança' },
        { id: 'trabalho', label: 'Trabalho e dinheiro' },
        { id: 'caminhos', label: 'Caminhos e decisões' },
        { id: 'outro', label: 'Outro tema' },
    ];

    const STARTERS = {
        geral: ['O que preciso saber sobre este momento?', 'Que caminho devo seguir agora?', 'O que está travando a minha vida?'],
        amor: ['O que essa pessoa sente por mim?', 'Essa relação tem futuro?', 'Vou conhecer alguém em breve?'],
        desconfianca: ['Existe algo escondido nessa relação?', 'Essa pessoa está sendo sincera comigo?', 'Tem outra pessoa nessa história?'],
        trabalho: ['Vale a pena mudar de emprego agora?', 'Como vai ficar minha vida financeira?', 'Esse projeto vai dar certo?'],
        caminhos: ['Qual decisão me faz bem agora?', 'O que me espera nos próximos meses?', 'O que preciso deixar para trás?'],
    };

    const FORMATS = [
        { id: 'pergunta-objetiva', text: 'Uma questão pontual, com resposta direta.' },
        { id: 'pergunta-aprofundada', text: 'Análise detalhada de uma situação específica, com conselhos.' },
        { id: 'templo-afrodite', topic: 'amor', text: 'Tiragem própria para o amor: pensamentos, sentimentos, intenções e futuro.' },
        { id: 'templo-diabo', topic: 'desconfianca', text: 'Tiragem para relações intensas: apego, mentiras, desejos e o que está escondido.' },
    ];

    // Vela desenhada à mão (marcação fixa, sem dados da pessoa)
    const CANDLE_SVG = `
        <svg viewBox="0 0 80 124" aria-hidden="true">
            <defs>
                <radialGradient id="ritual-flame" cx="50%" cy="72%" r="62%">
                    <stop offset="0" stop-color="#fffbea"/>
                    <stop offset=".45" stop-color="#f4d98f"/>
                    <stop offset="1" stop-color="#c5a559"/>
                </radialGradient>
                <radialGradient id="ritual-glow">
                    <stop offset="0" stop-color="#f6dfa0" stop-opacity=".75"/>
                    <stop offset="1" stop-color="#f6dfa0" stop-opacity="0"/>
                </radialGradient>
            </defs>
            <circle class="candle-glow" cx="40" cy="30" r="30" fill="url(#ritual-glow)"/>
            <g class="candle-flame">
                <path d="M40 8c7 10 10 16 10 22a10 10 0 0 1-20 0c0-6 3-12 10-22z" fill="url(#ritual-flame)"/>
                <path d="M40 22c3 4 4.5 7 4.5 10a4.5 4.5 0 0 1-9 0c0-3 1.5-6 4.5-10z" fill="#fffdf5"/>
            </g>
            <path d="M40 46v-8" stroke="#2c3a33" stroke-width="2.2" stroke-linecap="round"/>
            <rect x="24" y="45" width="32" height="64" rx="5" fill="#f3f0e9"/>
            <path d="M24 53c4 2 8 1 11 4 2 2 4 2 6 0 3-3 8-1 15-4" fill="none" stroke="#c5a559" stroke-width="1.6" stroke-linecap="round"/>
            <ellipse cx="40" cy="45" rx="16" ry="3.6" fill="#e6dfcf"/>
            <rect x="16" y="107" width="48" height="9" rx="4.5" fill="#c5a559"/>
        </svg>`;

    let draft = { text: '', topic: '' };
    let ritualMode = 'selada'; // 'selada' (com pergunta) ou 'whatsapp' (contar por lá)
    let ritualLit = false;
    let ritualReturn = null;

    function ritualSwap(node, focusEl, animate) {
        const old = ritualStage.firstElementChild;
        const put = () => {
            ritualStage.replaceChildren(node);
            ritualStage.scrollTop = 0;
            focusEl.focus({ preventScroll: true });
        };
        if (animate && old && !reduceMotion) {
            old.querySelectorAll('button, input, textarea').forEach((el) => { el.disabled = true; });
            old.classList.add('is-leaving');
            setTimeout(put, 180);
        } else {
            put();
        }
    }

    function ritualHeading(text) {
        const heading = make('h2', 'ritual-title', text);
        heading.id = 'ritual-title';
        heading.tabIndex = -1;
        return heading;
    }

    function renderQuestionStep(animate) {
        const node = make('div', 'ritual-step');
        const moonName = (document.querySelector('[data-moon-name]') || {}).textContent;
        const kicker = make('div', 'ritual-head');
        kicker.append(make('p', 'kicker ritual-kicker', 'Ritual da pergunta'));
        if (moonName) kicker.append(make('p', 'ritual-moon', moonName));

        // A vela: acende num toque ou quando a pessoa começa a escrever (nunca é obrigatória)
        const candleWrap = make('div', 'candle-wrap');
        const candle = make('button', 'candle');
        candle.type = 'button';
        candle.innerHTML = CANDLE_SVG;
        const candleHint = make('p', 'candle-hint');
        candleHint.setAttribute('aria-live', 'polite');
        candleWrap.append(candle, candleHint);

        const setLit = (lit, interactive) => {
            ritualLit = lit;
            candleWrap.classList.toggle('is-lit', lit);
            candle.setAttribute('aria-pressed', String(lit));
            candle.setAttribute('aria-label', lit ? 'Vela acesa' : 'Acender a vela');
            candleHint.textContent = lit ? 'A chama está acesa. Pense no que você quer saber.' : 'Toque na vela para acender';
            if (lit && interactive) {
                haptic(14);
                if (!reduceMotion) burst(candleWrap, { count: 8, distance: 44, className: 'spark spark--center' });
            }
        };
        setLit(ritualLit, false);
        candle.addEventListener('click', () => { if (!ritualLit) setLit(true, true); });

        const heading = ritualHeading('Qual é a sua pergunta?');

        // Tema (opcional): muda as sugestões e as leituras oferecidas depois
        const topics = make('fieldset', 'ritual-topics');
        topics.append(make('legend', 'ritual-legend', 'Sobre o que é? (opcional)'));
        const chips = make('div', 'ritual-chips');
        TOPICS.forEach((topic) => {
            const label = make('label', 'ritual-chip');
            const input = make('input');
            input.type = 'radio';
            input.name = 'ritual-tema';
            input.value = topic.id;
            input.checked = draft.topic === topic.id;
            label.append(input, make('span', '', topic.label));
            chips.append(label);
        });
        topics.append(chips);

        const field = make('div', 'ritual-field');
        const label = make('label', 'ritual-label', 'Sua pergunta para o Guilherme');
        label.htmlFor = 'ritual-q';
        const area = make('textarea', 'ritual-input');
        area.id = 'ritual-q';
        area.rows = 4;
        area.maxLength = QUESTION_MAX;
        area.placeholder = 'Escreva do seu jeito. Ex.: O que posso esperar da minha vida amorosa nos próximos meses?';
        area.setAttribute('aria-describedby', 'ritual-privacidade ritual-erro');
        area.value = draft.text;
        const counter = make('span', 'ritual-count');
        counter.setAttribute('aria-hidden', 'true');
        const remaining = make('span', 'sr-only');
        remaining.setAttribute('aria-live', 'polite');
        field.append(label, area, counter, remaining);

        const starters = make('div', 'ritual-starters');
        const starterList = make('div', 'ritual-starter-list');
        starters.append(make('p', 'ritual-starters-title', 'Sem palavras? Comece por aqui:'), starterList);

        const privacy = make('p', 'ritual-privacy', 'Sua pergunta fica só neste aparelho e vai apenas na mensagem que você envia pelo WhatsApp.');
        privacy.id = 'ritual-privacidade';
        const error = make('p', 'ritual-error');
        error.id = 'ritual-erro';
        error.setAttribute('role', 'alert');
        error.hidden = true;

        const sealBtn = make('button', 'btn btn-gold btn-shine btn-block');
        sealBtn.type = 'button';
        sealBtn.append(svgIcon('mark'), make('span', '', 'Selar minha pergunta'));
        const skip = make('button', 'text-btn ritual-skip', 'Prefiro contar no WhatsApp');
        skip.type = 'button';

        const updateCount = () => {
            const length = area.value.length;
            counter.textContent = `${length}/${QUESTION_MAX}`;
            remaining.textContent = length >= QUESTION_MAX - 40 ? `Faltam ${QUESTION_MAX - length} caracteres` : '';
        };
        const onInput = () => {
            draft.text = area.value;
            updateCount();
            if (!ritualLit) setLit(true, true);
            if (!error.hidden) {
                error.hidden = true;
                area.removeAttribute('aria-invalid');
            }
        };
        const fillStarters = () => {
            starterList.replaceChildren(...(STARTERS[draft.topic] || STARTERS.geral).map((text) => {
                const btn = make('button', 'ritual-starter', text);
                btn.type = 'button';
                btn.addEventListener('click', () => {
                    area.value = text;
                    onInput();
                    area.focus();
                    area.setSelectionRange(text.length, text.length);
                });
                return btn;
            }));
        };

        area.addEventListener('input', onInput);
        topics.addEventListener('change', (event) => {
            draft.topic = event.target.value;
            fillStarters();
        });
        sealBtn.addEventListener('click', () => {
            if (area.value.trim().length < 8) {
                error.textContent = 'Escreva sua pergunta (algumas palavras bastam) ou toque em “Prefiro contar no WhatsApp”.';
                error.hidden = false;
                area.setAttribute('aria-invalid', 'true');
                area.focus();
                haptic([18, 60, 18]);
                return;
            }
            draft.text = area.value;
            ritualMode = 'selada';
            renderFormatStep();
        });
        skip.addEventListener('click', () => {
            ritualMode = 'whatsapp';
            renderFormatStep();
        });

        fillStarters();
        updateCount();
        // O botão vem logo depois do campo (alcançável com o teclado aberto); as sugestões, depois
        node.append(kicker, candleWrap, heading, topics, field, error, sealBtn, skip, starters, privacy);
        ritualSwap(node, heading, animate);
    }

    function renderFormatStep() {
        const node = make('div', 'ritual-step');
        const sealed = ritualMode === 'selada';
        const head = make('div', 'ritual-head');
        head.append(make('p', 'kicker ritual-kicker', sealed ? 'Pergunta selada' : 'Tudo bem: você conta por lá'));
        node.append(head);

        if (sealed) {
            const slip = make('div', 'ritual-slip');
            slip.append(make('p', 'ritual-slip-text', `“${draft.text.trim()}”`));
            const seal = make('span', 'seal seal--stamp');
            seal.setAttribute('aria-hidden', 'true');
            seal.append(svgIcon('mark'));
            slip.append(seal);
            node.append(slip);
            if (!reduceMotion) {
                setTimeout(() => {
                    burst(seal, { count: 9, distance: 46, className: 'spark spark--center' });
                    haptic(14);
                }, 640);
            }
        }

        const heading = ritualHeading('Como você quer a resposta?');
        const formats = make('fieldset', 'ritual-formats');
        formats.setAttribute('aria-labelledby', 'ritual-title');
        const options = FORMATS.filter((format) => catalog.has(format.id) && (!format.topic || format.topic === draft.topic));
        let chosen = options[0].id;

        options.forEach((format) => {
            const product = catalog.get(format.id);
            const label = make('label', 'ritual-format');
            const input = make('input');
            input.type = 'radio';
            input.name = 'ritual-formato';
            input.value = format.id;
            input.checked = format.id === chosen;
            const body = make('span', 'ritual-format-body');
            const top = make('span', 'ritual-format-top');
            top.append(make('span', 'ritual-format-name', product.name), make('span', 'ritual-format-price', shortPrice(product.price)));
            body.append(top, make('span', 'ritual-format-text', format.text));
            label.append(input, body);
            formats.append(label);
        });

        const go = make('button', 'btn btn-gold btn-shine btn-block');
        go.type = 'button';
        const goLabel = make('span');
        go.append(goLabel, svgIcon('i-arrow'));
        const updateGo = () => { goLabel.textContent = `Seguir para o pedido · ${shortPrice(catalog.get(chosen).price)}`; };
        formats.addEventListener('change', (event) => {
            chosen = event.target.value;
            updateGo();
        });
        updateGo();
        go.addEventListener('click', () => finishRitual(chosen));

        const back = make('button', 'text-btn ritual-skip', sealed ? 'Reescrever minha pergunta' : 'Escrever minha pergunta aqui');
        back.type = 'button';
        back.addEventListener('click', () => renderQuestionStep(true));

        const foot = make('p', 'ritual-foot', 'Nada é cobrado aqui. No WhatsApp, o Guilherme envia o PIX ou o link do cartão e, após o comprovante, sua leitura chega em até 3 dias.');

        node.append(heading, formats, go, back, foot);
        ritualSwap(node, heading, true);
    }

    function finishRitual(id) {
        if (ritualMode === 'selada') setQuestion({ text: draft.text, topic: draft.topic });
        else clearQuestion();
        if (findItem(itemKey(id, null))) render();
        else addItem(id);

        const returnTo = ritualReturn;
        closeRitual({ restoreFocus: false });
        draft = { text: '', topic: '' };
        ritualMode = 'selada';
        ritualLit = false;
        setTimeout(() => openCart({ returnFocus: returnTo, highlight: id }), reduceMotion ? 0 : 320);
    }

    function showRitual(returnTo) {
        if (anyModalOpen()) return;
        ritualReturn = returnTo;
        setMenu(false);
        toastRegion.replaceChildren();
        ritual.inert = false;
        ritual.classList.add('is-open');
        ritualBackdrop.classList.add('is-open');
        lockPage();
        renderQuestionStep(false);
    }

    function openRitual(trigger) {
        if (isRitualOpen() || isCartOpen()) return;
        if (isOracleOpen()) {
            // vem da carta do dia: fecha a carta e abre o ritual em seguida
            const returnTo = oracleReturn;
            closeOracle({ restoreFocus: false });
            setTimeout(() => showRitual(returnTo), reduceMotion ? 0 : 300);
            return;
        }
        showRitual(trigger);
    }

    function closeRitual({ restoreFocus = true } = {}) {
        if (!isRitualOpen()) return;
        ritual.classList.remove('is-open');
        ritualBackdrop.classList.remove('is-open');
        ritual.inert = true;
        unlockPage();
        if (restoreFocus && ritualReturn && document.contains(ritualReturn)) ritualReturn.focus({ preventScroll: true });
    }

    // Preço mínimo das leituras (vem do catálogo, nunca escrito duas vezes)
    const servicePrices = [...catalog.values()].filter((product) => product.kind === 'servico').map((product) => product.price);
    if (servicePrices.length) {
        const minPrice = shortPrice(Math.min(...servicePrices));
        document.querySelectorAll('[data-min-price]').forEach((el) => { el.textContent = minPrice; });
    }

    // Dúvidas nos pontos de decisão: a mensagem já diz sobre o que é
    document.querySelectorAll('[data-ask]').forEach((link) => {
        link.href = waUrl(`Olá, Guilherme! Vim pelo site da Noctun Tarot e tenho uma dúvida sobre ${link.dataset.ask}.`);
    });

    render();
    document.documentElement.dataset.ready = '';
})();

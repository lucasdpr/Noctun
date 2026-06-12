/**
 * SISTEMA DE E-COMMERCE - NOCTUN TAROT
 * Gerenciamento de Estado e UI Dinâmica
 */

// 1. Estado da Aplicação (Onde os dados vivem)
let carrinho = [];

// 2. Referências do DOM (Elementos que vamos manipular)
const cartSidebar = document.getElementById('cart-sidebar');
const cartOverlay = document.getElementById('cart-overlay');
const cartItemsContainer = document.getElementById('cart-items');
const cartBadge = document.getElementById('cart-badge');
const cartTotalValue = document.getElementById('cart-total-value');
const toastContainer = document.getElementById('toast-container');

// 3. Funções Principais do Carrinho

function adicionarAoCarrinho(nomeProduto, preco) {
    // Cria o objeto do item
    const item = {
        id: Date.now(), // Gera um ID único baseado no tempo
        nome: nomeProduto,
        preco: preco
    };

    // Atualiza o estado
    carrinho.push(item);
    
    // Atualiza a Interface
    atualizarUI();
    
    // Mostra notificação de sucesso
    mostrarToast(`${nomeProduto} adicionado!`);
}

function removerDoCarrinho(idItem) {
    // Filtra o array, removendo o item com o ID correspondente
    carrinho = carrinho.filter(item => item.id !== idItem);
    atualizarUI();
}

function calcularTotal() {
    // Reduz o array somando os preços
    return carrinho.reduce((total, item) => total + item.preco, 0);
}

function atualizarUI() {
    // Atualiza a bolinha (badge) do carrinho no Header
    cartBadge.textContent = carrinho.length;

    // Atualiza o valor total formatado
    const total = calcularTotal();
    cartTotalValue.textContent = formatarMoeda(total);

    // Limpa a lista atual do HTML
    cartItemsContainer.innerHTML = '';

    // Renderiza os itens baseados no estado
    if (carrinho.length === 0) {
        cartItemsContainer.innerHTML = '<p class="empty-cart">Seu carrinho está vazio.</p>';
        return;
    }

    carrinho.forEach(item => {
        const divElement = document.createElement('div');
        divElement.classList.add('cart-item');
        
        divElement.innerHTML = `
            <div class="item-info">
                <h4>${item.nome}</h4>
                <p>${formatarMoeda(item.preco)}</p>
            </div>
            <button class="btn-remove" onclick="removerDoCarrinho(${item.id})" title="Remover item">
                <span class="material-symbols-outlined">delete</span>
            </button>
        `;
        
        cartItemsContainer.appendChild(divElement);
    });
}

// 4. Controle de Modais e Interações Visuais

function toggleCart() {
    // Alterna a classe 'open' no sidebar e 'active' no overlay escuro
    cartSidebar.classList.toggle('open');
    cartOverlay.classList.toggle('active');
}

function mostrarToast(mensagem) {
    // Cria o elemento da notificação
    const toast = document.createElement('div');
    toast.classList.add('toast');
    toast.textContent = mensagem;

    // Adiciona ao container na tela
    toastContainer.appendChild(toast);

    // Adiciona classe para fazer a animação de entrada
    setTimeout(() => toast.classList.add('show'), 10);

    // Remove da tela após 3 segundos
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400); // Aguarda a animação de saída
    }, 3000);
}

// 5. Integração com WhatsApp (Checkout)

function finalizarCompra() {
    if (carrinho.length === 0) {
        mostrarToast("Adicione itens ao carrinho primeiro!");
        return;
    }

    const telefone = "5524999894376"; 
    
    // Constrói a mensagem mapeando os itens do carrinho
    let textoPedido = "🔮 *Olá Guilherme! Gostaria de agendar/solicitar os seguintes itens:*\n\n";
    
    carrinho.forEach((item, index) => {
        textoPedido += `${index + 1}. ${item.nome} - ${formatarMoeda(item.preco)}\n`;
    });

    // Adiciona o total e os campos requeridos
    textoPedido += `\n*Total do Pedido:* ${formatarMoeda(calcularTotal())}\n`;
    textoPedido += `\n-------------------------\n`;
    textoPedido += `*Meus Dados:*\n`;
    textoPedido += `- Nome Completo: \n`;
    textoPedido += `- Data de Nascimento: \n`;
    textoPedido += `- Contexto/História: \n`;

    // Codifica para formato URL
    const urlFormatada = encodeURIComponent(textoPedido);
    
    // Abre a janela do WhatsApp com a mensagem pronta
    window.open(`https://wa.me/${telefone}?text=${urlFormatada}`, '_blank');
}

// 6. Funções Utilitárias

function formatarMoeda(valor) {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Efeito de sombra na Navbar ao rolar a página
window.addEventListener('scroll', () => {
    const navbar = document.getElementById('navbar');
    if (window.scrollY > 50) {
        navbar.style.boxShadow = '0 4px 20px rgba(0,0,0,0.5)';
    } else {
        navbar.style.boxShadow = 'none';
    }
});
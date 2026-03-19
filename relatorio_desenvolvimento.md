# 🚀 Documentação de Desenvolvimento: Securo Finance (Granafy)

Este documento detalha todas as melhorias visuais, arquiteturais e de Inteligência Artificial implementadas no projeto. O objetivo foi transformar a base do Securo em um assistente financeiro premium, preditivo e de alto impacto visual.

---

## 🎨 1. Redesign e UI/UX (Interface e Experiência)
Toda a interface foi repensada para ter uma estética moderna, fluida e amigável (inspirada no Monity).

*   **Dashboard em Bento Grid**: Transformamos a tela principal em um grid super moderno com efeito de *Glassmorphism* (cartões translúcidos com blur), separando claramente a "Saúde Financeira", "Entradas/Saídas" e "Saldo".
*   **Contas vs. Cartões de Crédito**: Separação clara no painel. Contas correntes agrupadas por banco no seletor, e cartões de crédito ganharam "Mini-Cards Premium" na tela principal mostrando bandeira, 4 últimos dígitos, limite usado e fatura atual.
*   **Sidebar Inteligente**: O menu lateral (sidebar) agora agrupa contas e cartões por Instituição Bancária (dropdowns colapsáveis).
*   **Drag-and-Drop (Arrastar e Soltar)**: Adicionado suporte para reordenar suas contas e cartões manualmente na sidebar, com as posições sendo salvas no banco de dados.
*   **Modo Privacidade Total**: Adicionado um sistema de 3 estados (Visível, Blur, Oculto) para esconder valores monetários caso você esteja abrindo o app em público.
*   **Edição Inline**: Você agora pode renomear apelidos das contas direto pela UI, com um botão rápido para restaurar o nome original vindo do banco.

---

## 🤖 2. Inteligência Artificial e Conselheiro (Flavinho do Pneu 🛞)
A IA deixou de ser um chat genérico e passou a ser um agente proativo, conectado com seus dados reais.

*   **Arquitetura Multi-Provider**: O backend agora suporta conectar-se nativamente a múltiplos provedores: **OpenAI** (GPTs), **Anthropic** (Claude) e **AbacusAI** (Gateway Universal). Tudo configurável via interface de usuário.
*   **Contexto Individualizado por Conta**: A IA lê seu saldo, faturas, gastos e entradas separadamente por conta, permitindo que você faça perguntas específicas como: *"Quanto eu gastei de Uber no Itaú esse mês?"*
*   **Criação de Gastos por Chat (Function Calling)**: A IA agora tem permissão para usar ferramentas. Se você disser *"Gastei 50 reais de padaria ontem no Nubank"*, ela cria a transação silenciosamente no seu banco de dados.
*   **Mini-Chat Flutuante**: Criamos um widget (uma bolha de chat charmosa com Glassmorphism) que fica na sua página principal para você interagir com a IA sem precisar mudar de tela.
*   **Detecção de Parcelas**: A IA consegue ver o que são compras à vista e o que são parcelamentos.

---

## ⚙️ 3. Regras Magicas e Automação (Backend)
O motor de análise e categorização de dados foi drasticamente evoluído para reduzir o trabalho manual.

*   **Detecção Automática de Transferências**: Criamos um algoritmo complexo que cruza os dados das suas contas para entender quando você enviou dinheiro de uma conta para outra (ex: Nubank -> Itaú). O sistema "linka" essas duas operações para que elas não contem como um "gasto falso" nem como uma "renda falsa".
*   **Varinha Mágica (Quick Rules)**: Um clique rápido e você cria uma regra de categorização automática para transações parecidas. Ex: Clica em uma transação do "iFood", o sistema sugere criar a regra para jogar tudo que tem "iFood" para "Alimentação", e já reprocessa o histórico do mês inteiro na hora.
*   **Correção de Faturas**: Pagamentos de fatura de cartão de crédito agora são identificados automaticamente.
*   **Limpeza Automática**: O sistema remove regras duplicadas e redundantes para manter a base limpa.

---

## 🎯 4. Metas de Economia (Savings Goals)
Um módulo inteiramente novo criado do zero, do banco de dados ao visual, para você planejar sonhos ou juntar reservas.

*   **Página Dedicada**: Bela página de acompanhamento de metas coloridas com emojis, fundo blur e design imersivo.
*   **Registro de Depósitos**: Registre evoluções de uma meta com animações.
*   **Widget no Dashboard**: Um resumo das "Metas Ativas" agora aparece na tela inicial junto com o seu saldo.

---

### Resumo Tecnológico
- **Frontend**: React (Vite), TailwindCSS, Tanstack Query, `dnd-kit` (Drag&Drop), `framer-motion` (Animações).
- **Backend**: FastAPI (Python), SQLAlchemy, Alembic (para migrações de banco como no caso das contas e metas).
- **IA**: Integração via Server-Sent Events (SSE) para respostas "digitadas" em tempo real, suporte ao padrão `stream_options` (OpenAI o-series).

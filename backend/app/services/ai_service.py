"""
AI Financial Advisor Service.
Gathers financial context from Granafy's database and provides it to the LLM.
"""

import uuid
import json
from datetime import date
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import dashboard_service, account_service, category_service


async def get_financial_context(
    session: AsyncSession,
    user_id: uuid.UUID,
    month: Optional[date] = None,
) -> str:
    """Build a comprehensive financial context string for the AI advisor.
    Pulls real data from the dashboard service and formats it as structured text.
    Generates PER-ACCOUNT summaries so the AI can analyze each account individually."""

    if not month:
        month = date.today().replace(day=1)

    # Gather global data
    summary = await dashboard_service.get_summary(session, user_id, month)
    spending = await dashboard_service.get_spending_by_category(session, user_id, month)
    trend = await dashboard_service.get_monthly_trend(session, user_id, months=6)
    projected = await dashboard_service.get_projected_transactions(session, user_id, month)

    context_parts = []

    # ── 1. Per-Account Summaries ──
    accounts = await account_service.get_accounts(session, user_id)
    context_parts.append("## RESUMO INDIVIDUAL POR CONTA")
    context_parts.append(f"Período: {month.strftime('%Y-%m')}")
    context_parts.append("")

    for acc in accounts:
        acc_name = acc.get('custom_name') or acc['name']
        acc_type = acc['type']
        acc_id = acc['id']
        current_balance = acc.get('current_balance', 0)

        # Get per-account summary from the account service
        acc_summary = await account_service.get_account_summary(session, acc_id, user_id)

        type_label = {
            'checking': '🏦 Conta Corrente',
            'credit_card': '💳 Cartão de Crédito',
            'savings': '🏧 Poupança',
        }.get(acc_type, f'📄 {acc_type}')

        context_parts.append(f"### {type_label}: {acc_name}")
        context_parts.append(f"  ID: {acc_id}")

        if acc_type == 'credit_card':
            # For credit cards, show as "Fatura do Mês"
            credit_data = acc.get('credit_data') or {}
            limit_val = credit_data.get('limit') or credit_data.get('creditLimit')
            context_parts.append(f"  Fatura do Mês: R$ {abs(acc_summary['monthly_expenses']) if acc_summary else 0:,.2f}")
            context_parts.append(f"  Saldo (dívida): R$ {current_balance:,.2f}")
            if limit_val:
                context_parts.append(f"  Limite Total: R$ {float(limit_val):,.2f}")
                context_parts.append(f"  Limite Disponível: R$ {float(limit_val) - abs(current_balance):,.2f}")
        else:
            if acc_summary:
                context_parts.append(f"  Saldo Atual: R$ {current_balance:,.2f}")
                context_parts.append(f"  Entradas do Mês: R$ {acc_summary['monthly_income']:,.2f}")
                context_parts.append(f"  Saídas do Mês: R$ {acc_summary['monthly_expenses']:,.2f}")
                net_acc = acc_summary['monthly_income'] - acc_summary['monthly_expenses']
                context_parts.append(f"  Resultado Líquido: R$ {net_acc:,.2f}")
            else:
                context_parts.append(f"  Saldo Atual: R$ {current_balance:,.2f}")
        context_parts.append("")

    # ── 2. Resumo Global Consolidado ──
    context_parts.append("## RESUMO GLOBAL CONSOLIDADO")
    for currency, balance in summary.total_balance.items():
        context_parts.append(f"Saldo total ({currency}): R$ {balance:,.2f}")
    context_parts.append(f"Renda mensal (global, excl. transferências): R$ {summary.monthly_income:,.2f}")
    context_parts.append(f"Despesas mensais (global, excl. transferências e CC): R$ {summary.monthly_expenses:,.2f}")
    net = summary.monthly_income - summary.monthly_expenses
    context_parts.append(f"Resultado líquido: R$ {net:,.2f}")
    savings_rate = (net / summary.monthly_income * 100) if summary.monthly_income > 0 else 0
    context_parts.append(f"Taxa de poupança: {savings_rate:.1f}%")
    if summary.pending_categorization > 0:
        context_parts.append(f"⚠️ Transações sem categoria: {summary.pending_categorization} (R$ {summary.pending_categorization_amount:,.2f})")
    if summary.assets_value:
        for currency, value in summary.assets_value.items():
            context_parts.append(f"Patrimônio em ativos ({currency}): R$ {value:,.2f}")
    context_parts.append("")

    # ── 3. Gastos por Categoria ──
    context_parts.append("## GASTOS POR CATEGORIA")
    if spending:
        for s in spending[:15]:
            context_parts.append(f"  - {s.category_name}: R$ {s.total:,.2f} ({s.percentage:.1f}%)")
    else:
        context_parts.append("  Sem dados de gastos no período.")
    context_parts.append("")

    # ── 4. Tendência Mensal ──
    context_parts.append("## TENDÊNCIA MENSAL (últimos 6 meses)")
    if trend:
        for t in trend:
            net_t = t.income - t.expenses
            context_parts.append(f"  {t.month}: Renda R$ {t.income:,.2f} | Gastos R$ {t.expenses:,.2f} | Líquido R$ {net_t:,.2f}")
    else:
        context_parts.append("  Sem dados de tendência.")
    context_parts.append("")

    # ── 5. Transações Projetadas ──
    if projected:
        context_parts.append("## TRANSAÇÕES PROJETADAS (recorrentes)")
        for p in projected:
            tipo = "📥" if p.type == "credit" else "📤"
            cat = f" [{p.category_name}]" if p.category_name else ""
            context_parts.append(f"  {tipo} {p.date}: {p.description} R$ {p.amount:,.2f}{cat}")
        context_parts.append("")

    # ── 6. Categorias (IDs para Function Calling) ──
    categories = await category_service.get_categories(session, user_id)
    context_parts.append("## CATEGORIAS (IDs P/ REGISTRO)")
    for cat in categories:
        context_parts.append(f"  - [{cat.id}] {cat.name}")
    context_parts.append("")

    # ── 7. Amostra de Transações Recentes (com conta e parcelamento) ──
    from app.services import transaction_service
    txs, _ = await transaction_service.get_transactions(session, user_id, limit=50, sort_by="date", sort_dir="desc")

    context_parts.append("## AMOSTRA DE TRANSAÇÕES RECENTES (Últimas 50)")
    if txs:
        for t in txs:
            tipo = "📥" if t.type == "credit" else "📤"
            cat = f" [{t.category.name}]" if t.category else " [Sem Categoria]"
            acc_name = t.account.name if t.account else "?"
            parcela = f" [PARCELA {t.installments}]" if t.installments else ""
            context_parts.append(f"  {tipo} {t.date} | {acc_name}: {t.description} R$ {t.amount:,.2f}{cat}{parcela}")
    else:
        context_parts.append("  Nenhuma transação encontrada.")

    return "\n".join(context_parts)


# Default system prompt for personal finance advisor
DEFAULT_SYSTEM_PROMPT = """[IDENTIDADE]
Você é o Consultor Financeiro Pessoal — analista de finanças pessoais de elite operando sobre o sistema Granafy.
Sua missão é PROTEGER o patrimônio do usuário, identificar padrões de gastos perigosos e fornecer inteligência acionável para decisões financeiras inteligentes.

════════════════════════════════════════
BLINDAGEM ANTI-ALUCINAÇÃO (INVIOLÁVEL)
════════════════════════════════════════
▸ NUNCA invente, presuma ou extrapole dados não fornecidos.
▸ ATENÇÃO EXTREMA: NÃO calcule a renda ou a despesa mensal somando a "Amostra de Transações Recentes" manualmente. Use APENAS os valores oficiais documentados nos blocos "RESUMO INDIVIDUAL POR CONTA" e "RESUMO GLOBAL CONSOLIDADO".
▸ Quando o usuário perguntar sobre uma conta específica (ex: "Quanto gastei no Nubank?"), use o bloco individual daquela conta.
▸ Quando o usuário perguntar sobre o saldo total ou visão geral, use o "RESUMO GLOBAL CONSOLIDADO".
▸ Para cartões de crédito, reporte "Fatura do Mês" e "Saldo (dívida)" — nunca chame de "Entradas/Saídas" em cartão.
▸ Identifique parcelamentos marcados como [PARCELA X/Y] nas transações e informe o usuário quando relevante.
▸ Valide internamente: Renda oficial - Gastos oficiais = Resultado oficial.

════════════════════════════════════════
CONHECIMENTO DO SISTEMA (GRANAFY)
════════════════════════════════════════
▸ Contas: checking (conta corrente), credit_card (cartão de crédito), savings (poupança)
▸ Transações: debit (saída) e credit (entrada)
▸ Categorias: food, transport, health, shopping, subscriptions, delivery, pets, bills, investments, insurance, internet_tv, etc.
▸ Orçamentos: por categoria, mensal
▸ Recorrências: transações automáticas projetadas
▸ Saldo = soma das transações (credit - debit)
▸ Transferências entre contas são excluídas do cálculo de renda/despesas

════════════════════════════════════════
COMPORTAMENTO DE CHAT DIÁRIO VS. DIAGNÓSTICO PROFUNDO
════════════════════════════════════════
▸ SE O USUÁRIO FIZER UMA PERGUNTA ESPECÍFICA (Ex: "Quanto gastei no iFood?", "Qual meu maior gasto livre?"), **APENAS RESPONDA À PERGUNTA** de forma direta e concisa. NÃO exiba relatórios complexos se não for pedido.
▸ Use a "Amostra de Transações Recentes" no contexto financeiro bruto para responder dúvidas granulares sobre gastos, nomes de estabelecimentos ou valores pontuais do mês.
▸ SE O USUÁRIO PEDIR UM DIAGNÓSTICO GERAL, UM RELATÓRIO DE SAÚDE, OU INICIAR UMA ANÁLISE DO ZERO (sem perguntas restritas), AÍ SIM APLIQUE O MODELO QUANTITATIVO OBRIGATÓRIO ABAIXO.

════════════════════════════════════════
MODELO QUANTITATIVO OBRIGATÓRIO (QUANDO SOLICITADO)
════════════════════════════════════════
Todo diagnóstico global DEVE calcular e apresentar:

1. TAXA DE POUPANÇA (TP)
   TP = (Renda - Gastos) / Renda × 100
   Crítico se < 10%. Ideal > 30%.

2. ÍNDICE DE COMPROMETIMENTO (IC)
   IC = Gastos Fixos / Renda Total × 100
   Critico se > 70%.

3. CONCENTRAÇÃO DE GASTOS (CG)
   % dos gastos concentrados nas top 3 categorias.

4. TENDÊNCIA MENSAL
   Direção dos gastos nos últimos 3-6 meses: crescente, estável ou decrescente.

5. SCORE DE SAÚDE FINANCEIRA (0-100)
   Fórmula: 30% TP + 25% IC + 20% Tendência + 15% Diversificação + 10% Regularidade
   Regularidade = transações categorizadas / total

════════════════════════════════════════
STRESS TEST (OBRIGATÓRIO EM ANÁLISES MACRO)
════════════════════════════════════════
Simular 3 cenários:
  BASE: dados reais
  CONSERVADOR: Renda -15%, Gastos fixos mantidos
  EMERGÊNCIA: Renda -40% (perda de emprego)
Recalcular TP, IC e Score em cada cenário.
Calcular MESES DE SOBREVIVÊNCIA = Saldo / Gastos mensais.

════════════════════════════════════════
PROTOCOLO DE ALERTAS AUTOMÁTICOS
════════════════════════════════════════
🔴 ALARME MÁXIMO:
  → Gastos > Renda (resultado negativo)
  → Saldo de conta negativo
  → Score < 30

🟠 ALERTA ALTO:
  → Taxa de poupança < 10%
  → Fatura de cartão > 40% da renda
  → Gastos com delivery/food > 25% da renda
  → Tendência de gastos crescente por 3+ meses

🟡 ATENÇÃO:
  → Transações sem categoria > 10%
  → Uma categoria concentra > 30% dos gastos
  → Sem orçamento definido

════════════════════════════════════════
CLASSIFICAÇÃO DE SAÚDE FINANCEIRA
════════════════════════════════════════
🟢 EXCELENTE → Score > 80
🟡 BOA → Score 65–80
🟠 ATENÇÃO → Score 50–65
🔴 CRÍTICA → Score < 50

════════════════════════════════════════
FORMATO DE RESPOSTA OBRIGATÓRIO PARA DIAGNÓSTICOS NASA/GLOBAIS
════════════════════════════════════════
*(Use apenas se precisar gerar o diagnóstico profundo)*

📊 RESUMO EXECUTIVO
  Saldo | Taxa de Poupança | Score | Tendência (2-3 linhas máximo)

🔢 INDICADORES QUANTITATIVOS
  TP | IC | CG | Score | Meses de Sobrevivência
  Fórmulas explícitas e rastreamento às fontes

📅 MAPA DE GASTOS
  Top categorias com valores e percentuais
  Comparação com meses anteriores

📈 ANÁLISE DE CENÁRIOS
  Base | Conservador | Emergência — com TP, IC e Score recalculados

🚨 CLASSIFICAÇÃO FINAL DE RISCO
  Nível + justificativa numérica + categorias críticas

⚠️ SINAIS DE ALERTA
  Categorias específicas | Valores exatos | Impacto calculado

🏦 POSIÇÃO PATRIMONIAL
  Saldo por conta | Fatura cartão | Ativos

💡 RECOMENDAÇÕES
  Ações priorizadas por impacto financeiro (SOMENTE se suportadas pelos dados)
  Nunca genérico — cite valores exatos, categorias e prazos

🔮 PROJEÇÃO
  Projeção 30/60/90 dias se nenhuma medida for tomada

════════════════════════════════════════
TOM E POSTURA
════════════════════════════════════════
Consultor financeiro pessoal: direto, empático mas firme, focado em resultados.
Prioridade absoluta: NÚMEROS → INTERPRETAÇÃO → AÇÃO.
Erros de dados são reportados, não ignorados.
Incerteza é declarada, não escondida.
Sem floreios, sem introduções cordiais, sem enrolação.
Sugira ações concretas: cortar assinatura X, reduzir delivery em Y%, renegociar Z.
SEMPRE complete a análise inteira. Se contexto insuficiente, sinalize e continue.
Responda SEMPRE em português brasileiro."""


def get_default_config() -> dict:
    """Return the default agent configuration."""
    return {
        "id": "financial-advisor",
        "name": "Flavinho do Pneu",
        "provider": "abacusai",
        "apiKey": "",
        "model": "gemini-3.1-pro-preview",
        "systemPrompt": DEFAULT_SYSTEM_PROMPT,
        "temperature": 0.15,
        "maxTokens": 12288,
        "tonePreference": "equilibrado",
        "focusAreas": [
            "Taxa de Poupança e Economia",
            "Gastos por Categoria",
            "Tendência Mensal",
            "Fatura de Cartão de Crédito",
            "Orçamentos e Metas",
            "Projeção de Cenários",
            "Score de Saúde Financeira",
        ],
    }

# backend/app/services/rule_service.py
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.rule import Rule
from app.models.category import Category
from app.models.transaction import Transaction
from app.schemas.rule import RuleCreate, RuleUpdate, QuickRuleCreate
from app.services.rule_engine import evaluate_conditions, apply_rule_actions
from app.services.category_service import DEFAULT_CATEGORIES_I18N


PLUGGY_CATEGORY_MAP = {
    # Alimentação
    "Eating out": "Alimentação",
    "Restaurants": "Alimentação",
    "Food": "Alimentação",
    "Food Delivery": "Alimentação",
    "Coffee shops": "Alimentação",
    "Bakeries": "Alimentação",
    "Fast Food": "Alimentação",
    
    # Mercado
    "Groceries": "Mercado",
    "Supermarkets": "Mercado",
    "Convenience stores": "Mercado",
    
    # Saúde
    "Pharmacy": "Saúde",
    "Health": "Saúde",
    "Medical services": "Saúde",
    "Doctors": "Saúde",
    "Dentists": "Saúde",
    "Gym": "Saúde",
    "Fitness": "Saúde",
    
    # Transporte
    "Taxi and ride-hailing": "Transporte",
    "Transport": "Transporte",
    "Gas": "Transporte",
    "Gas stations": "Transporte",
    "Travel": "Transporte",
    "Public transportation": "Transporte",
    "Parking": "Transporte",
    "Auto maintenance": "Transporte",
    "Vehicle": "Transporte",
    
    # Moradia
    "Housing": "Moradia",
    "Rent": "Moradia",
    "Utilities": "Moradia",
    "Home improvement": "Moradia",
    "Household": "Moradia",
    "Hardware": "Moradia",
    
    # Lazer & Educação & Compras
    "Entertainment": "Lazer",
    "Leisure": "Lazer",
    "Movies": "Lazer",
    "Music": "Lazer",
    "Education": "Educação",
    "Schools": "Educação",
    "Books": "Educação",
    "Clothing": "Compras",
    "Electronics": "Compras",
    "Shopping": "Compras",
    "Sporting goods": "Compras",
    "Pets": "Lazer",
    "Personal care": "Saúde",
    "Beauty": "Saúde",
    
    # Serviços Financeiros e Assinaturas
    "Subscriptions": "Assinaturas",
    "Online services": "Assinaturas",
    "Software": "Assinaturas",
    "Transfer": "Transferências",
    "Transfers": "Transferências",
    "Wire transfers": "Transferências",
    "Withdrawal": "Transferências",
    "Income": "Salário",
    "Salary": "Salário",
    "Investments": "Investimentos",
    "Loans": "Empréstimos",
    "Taxes": "Impostos",
    "Fees": "Taxas",
    "Bank fees": "Taxas",
    "Insurance": "Seguros",
    "99pay": "Transferências",
    "99Pay": "Transferências",
}



class DuplicateRuleError(Exception):
    """Raised when a rule with the same name already exists for a user."""
    pass


# ─── Universal rules (work for any language/country) ───
# Category values here use internal keys (e.g. "transport") that get resolved to the
# user's actual category name at creation time.
UNIVERSAL_RULES = [
    {"name": "Streaming (Netflix, Spotify, Disney+)", "conditions_op": "or", "conditions": [
        {"field": "description", "op": "starts_with", "value": "NETFLIX"},
        {"field": "raw_data.description", "op": "starts_with", "value": "NETFLIX"},
        {"field": "description", "op": "starts_with", "value": "SPOTIFY"},
        {"field": "raw_data.description", "op": "starts_with", "value": "SPOTIFY"},
        {"field": "description", "op": "starts_with", "value": "DISNEY"},
        {"field": "raw_data.description", "op": "starts_with", "value": "DISNEY"},
    ], "actions": [{"op": "set_category", "value": "subscriptions"}], "priority": 10},

    {"name": "Uber", "conditions_op": "or", "conditions": [
        {"field": "description", "op": "starts_with", "value": "UBER"},
        {"field": "raw_data.description", "op": "starts_with", "value": "UBER"},
    ], "actions": [{"op": "set_category", "value": "transport"}], "priority": 10},

    {"name": "Amazon", "conditions_op": "or", "conditions": [
        {"field": "description", "op": "starts_with", "value": "AMAZON"},
        {"field": "raw_data.description", "op": "starts_with", "value": "AMAZON"},
    ], "actions": [{"op": "set_category", "value": "shopping"}], "priority": 10},

    {"name": "Apple / Google Subscriptions", "conditions_op": "or", "conditions": [
        {"field": "description", "op": "contains", "value": "APPLE.COM/BILL"},
        {"field": "description", "op": "starts_with", "value": "GOOGLE *"},
    ], "actions": [{"op": "set_category", "value": "subscriptions"}], "priority": 10},

    {"name": "99 Food", "conditions_op": "or", "conditions": [
        {"field": "description", "op": "contains", "value": "99FOOD"},
        {"field": "description", "op": "contains", "value": "99 FOOD"},
        {"field": "raw_data.description", "op": "contains", "value": "99FOOD"},
        {"field": "raw_data.description", "op": "contains", "value": "99 FOOD"},
    ], "actions": [{"op": "set_category", "value": "food"}], "priority": 1},

    {"name": "Transferências PIX / Giovana / Recibos", "conditions_op": "or", "conditions": [
        {"field": "description", "op": "contains", "value": "Transferência enviada"},
        {"field": "description", "op": "contains", "value": "Transferência recebida"},
        {"field": "description", "op": "contains", "value": "Giovana da Silva Lima"},
        {"field": "description", "op": "contains", "value": "PIX TRANSF"},
        {"field": "raw_data.description", "op": "contains", "value": "PIX TRANSF"},
        {"field": "raw_data.description", "op": "contains", "value": "Giovana da Silva Lima"},
    ], "actions": [{"op": "set_category", "value": "transfers"}], "priority": 1},



    {"name": "Salary / Payroll", "conditions_op": "and", "conditions": [
        {"field": "description", "op": "regex", "value": "SALARY|PAYROLL|DIRECT DEPOSIT"},
    ], "actions": [{"op": "set_category", "value": "salary"}], "priority": 10},
]

# ─── Country-specific rule packs (optional, not auto-applied) ───
RULE_PACKS = {
    "BR": {
        "name": "Brazil",
        "flag": "\U0001F1E7\U0001F1F7",
        "rules": [
            {"name": "99 (Ride-hailing)", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "99POP"},
            ], "actions": [{"op": "set_category", "value": "transport"}], "priority": 10},

            {"name": "99 Food / Delivery Apps", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "99 FOOD"},
                {"field": "description", "op": "contains", "value": "99 TECNOLOGIA"},
                {"field": "description", "op": "starts_with", "value": "IFD*"},
                {"field": "description", "op": "starts_with", "value": "IFOOD"},
                {"field": "raw_data.description", "op": "starts_with", "value": "IFOOD"},
                {"field": "description", "op": "starts_with", "value": "RAPPI"},
                {"field": "raw_data.description", "op": "starts_with", "value": "RAPPI"},
            ], "actions": [{"op": "set_category", "value": "delivery"}], "priority": 5},

            {"name": "Mercado Livre", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "MERCADOLIVRE"},
                {"field": "description", "op": "starts_with", "value": "MERCADO LIVRE"},
            ], "actions": [{"op": "set_category", "value": "shopping"}], "priority": 10},

            {"name": "Pix Recebido", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "regex", "value": "(?i)pix.*recebid|recebid.*pix"},
                {"field": "description", "op": "regex", "value": "PIX.*RECEBIDO"},
            ], "actions": [{"op": "set_category", "value": "transfers"}], "priority": 50},

            {"name": "Transferência", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "TRANSFERENCIA"},
                {"field": "description", "op": "regex", "value": "(?i)transferência|transferencia"},
            ], "actions": [{"op": "set_category", "value": "transfers"}], "priority": 90},

            {"name": "Shopee / Magazine Luiza", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "SHOPEE"},
                {"field": "description", "op": "starts_with", "value": "MAGALU"},
                {"field": "description", "op": "starts_with", "value": "MAGAZINE LUIZA"},
            ], "actions": [{"op": "set_category", "value": "shopping"}], "priority": 10},

            {"name": "Drogaria / Farmácia", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "DROGARIA"},
                {"field": "description", "op": "contains", "value": "FARMACIA"},
                {"field": "description", "op": "contains", "value": "DROGA RAIA"},
                {"field": "description", "op": "contains", "value": "DROGASIL"},
            ], "actions": [{"op": "set_category", "value": "health"}], "priority": 10},

            {"name": "Uber Eats", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "UBER EATS"},
                {"field": "description", "op": "starts_with", "value": "UBEREATS"},
            ], "actions": [{"op": "set_category", "value": "food"}], "priority": 5},

            {"name": "Claro / Vivo / Tim", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "CLARO"},
                {"field": "description", "op": "starts_with", "value": "VIVO"},
                {"field": "description", "op": "starts_with", "value": "TIM"},
            ], "actions": [{"op": "set_category", "value": "internet_tv"}], "priority": 10},

            {"name": "Posto / Shell (Combustível)", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "POSTO"},
                {"field": "description", "op": "starts_with", "value": "SHELL"},
                {"field": "description", "op": "contains", "value": "COMBUSTIVEL"},
            ], "actions": [{"op": "set_category", "value": "transport"}], "priority": 10},

            {"name": "Supermercado / Carrefour / Assaí", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "SUPERMERCADO"},
                {"field": "description", "op": "starts_with", "value": "CARREFOUR"},
                {"field": "description", "op": "starts_with", "value": "ASSAI"},
            ], "actions": [{"op": "set_category", "value": "groceries"}], "priority": 10},

            {"name": "Smart Fit / Academia", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "SMART FIT"},
                {"field": "description", "op": "contains", "value": "ACADEMIA"},
            ], "actions": [{"op": "set_category", "value": "health"}], "priority": 10},

            {"name": "Aluguel", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "ALUGUEL"},
            ], "actions": [{"op": "set_category", "value": "housing"}], "priority": 10},

            {"name": "Salário / Folha", "conditions_op": "and", "conditions": [
                {"field": "description", "op": "regex", "value": "SALARIO|FOLHA|PGTO.*SALARIO"},
            ], "actions": [{"op": "set_category", "value": "salary"}], "priority": 10},

            {"name": "Salário Itaú", "conditions_op": "and", "conditions": [
                {"field": "description", "op": "regex", "value": "(?i)itau|itaú"},
                {"field": "amount", "op": "gte", "value": "1000"},
                {"field": "type", "op": "equals", "value": "credit"},
            ], "actions": [{"op": "set_category", "value": "salary"}], "priority": 5},

            {"name": "Dízimo / Doação", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "DIZIMO"},
                {"field": "description", "op": "contains", "value": "DOACAO"},
                {"field": "description", "op": "contains", "value": "CARIDADE"},
            ], "actions": [{"op": "set_category", "value": "donations"}], "priority": 10},

            {"name": "Pix Enviado", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "regex", "value": "(?i)pix.*enviad|enviad.*pix"},
                {"field": "description", "op": "regex", "value": "PIX.*ENVIADO|PIX.*TRANSF"},
            ], "actions": [{"op": "set_category", "value": "transfers"}], "priority": 50},

            {"name": "Estacionamento / Pedágio", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "ESTACIONAMENTO"},
                {"field": "description", "op": "contains", "value": "PEDAGIO"},
                {"field": "description", "op": "contains", "value": "SEM PARAR"},
                {"field": "description", "op": "regex", "value": "(?i)zona azul|estapar"},
            ], "actions": [{"op": "set_category", "value": "transport"}], "priority": 10},

            {"name": "Barbearia / Salão", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "BARBEARIA"},
                {"field": "description", "op": "contains", "value": "SALAO"},
                {"field": "description", "op": "contains", "value": "CABELEREIRO"},
            ], "actions": [{"op": "set_category", "value": "personal_care"}], "priority": 10},

            {"name": "IPTU / IPVA / Imposto", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "IPTU"},
                {"field": "description", "op": "contains", "value": "IPVA"},
                {"field": "description", "op": "contains", "value": "IMPOSTO"},
                {"field": "description", "op": "contains", "value": "DARF"},
                {"field": "description", "op": "regex", "value": "(?i)receita federal|simples nacional|das "},
            ], "actions": [{"op": "set_category", "value": "taxes"}], "priority": 10},

            {"name": "Condomínio", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "CONDOMINIO"},
            ], "actions": [{"op": "set_category", "value": "housing"}], "priority": 10},

            {"name": "Curso / Escola / Faculdade", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "ESCOLA"},
                {"field": "description", "op": "contains", "value": "FACULDADE"},
                {"field": "description", "op": "contains", "value": "UNIVERSIDADE"},
                {"field": "description", "op": "contains", "value": "UDEMY"},
                {"field": "description", "op": "contains", "value": "ALURA"},
                {"field": "description", "op": "regex", "value": "(?i)hotmart|kiwify|eduzz"},
            ], "actions": [{"op": "set_category", "value": "education"}], "priority": 10},

            # ── New rules: based on real Nubank transaction analysis ──

            {"name": "Pet Shop / Agropecuária", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "AGROEPET"},
                {"field": "description", "op": "contains", "value": "AGROPET"},
                {"field": "description", "op": "contains", "value": "PET SHOP"},
                {"field": "description", "op": "contains", "value": "PETSHOP"},
                {"field": "description", "op": "regex", "value": "(?i)cobasi|petz|zeedog"},
            ], "actions": [{"op": "set_category", "value": "pets"}], "priority": 10},

            {"name": "Pagamento de Fatura", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "regex", "value": "(?i)pagamento de fatura|pagto.*fatura|pgto.*fatura|fatura.*cart[aã]o"},
            ], "actions": [{"op": "set_category", "value": "bills"}], "priority": 5},

            {"name": "Débito em Conta / Cobrança", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "regex", "value": "(?i)d.bito em conta|deb automatico|cobranca"},
            ], "actions": [{"op": "set_category", "value": "bills"}], "priority": 50},

            {"name": "Investimentos (FII/Ações/Tesouro)", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "regex", "value": "(?i)compra de fii|venda de fii|compra de a(?:ç|c)|tesouro direto|cdb |lci |lca "},
                {"field": "description", "op": "regex", "value": "(?i)rico invest|xp invest|easynvest|clear cor|nu invest|banco inter"},
            ], "actions": [{"op": "set_category", "value": "investments"}], "priority": 5},

            {"name": "Seguros (Nu Seguro, Porto Seguro)", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "Nu Seguro"},
                {"field": "description", "op": "contains", "value": "NU SEGURO"},
                {"field": "description", "op": "contains", "value": "PORTO SEGURO"},
                {"field": "description", "op": "contains", "value": "SULAMERICA"},
                {"field": "description", "op": "regex", "value": "(?i)seguro de vida|seguro auto|^seguro "},
            ], "actions": [{"op": "set_category", "value": "insurance"}], "priority": 10},

            {"name": "Internet / Streaming / Serviços", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "NET FLEX"},
                {"field": "description", "op": "contains", "value": "DISCORD"},
                {"field": "description", "op": "contains", "value": "Discord"},
                {"field": "description", "op": "starts_with", "value": "NETFLIX"},
                {"field": "description", "op": "starts_with", "value": "SPOTIFY"},
                {"field": "description", "op": "regex", "value": "(?i)google youtube|dl\\*google|prime video|hbo max|disney|crunchyroll|globoplay"},
                {"field": "description", "op": "regex", "value": "(?i)apple\\.com|microsoft|xbox|playstation|nintendo|steam"},
            ], "actions": [{"op": "set_category", "value": "subscriptions"}], "priority": 5},

            {"name": "Serviços Essenciais (Contas de casa)", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "regex", "value": "(?i)enel|sabesp|comgas|light|copel|cemig|sanepar|ceg|vivo|claro|tim|oi|net|sky"},
            ], "actions": [{"op": "set_category", "value": "bills"}], "priority": 10},

            {"name": "Compras Online (Varejistas)", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "regex", "value": "(?i)tiktok|ebn \\*|ebanx|ec \\*melimais|shein|aliexpress|submarino|americanas|kabum|olx|amazon|shopee|mercado ?livre|magalu"},
            ], "actions": [{"op": "set_category", "value": "shopping"}], "priority": 8},

            {"name": "Padarias, Restaurantes e Delivery", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "regex", "value": "(?i)padaria|lanchonete|restaurante|burger king|subway|sushi|pizzaria|quentinha|ifood|rappi|z. delivery|uber *eats"},
            ], "actions": [{"op": "set_category", "value": "food"}], "priority": 8},

            {"name": "Bares e Baladas", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "regex", "value": "(?i)bar |cervejaria|boteco|chopp|pub |bebida|adega"},
            ], "actions": [{"op": "set_category", "value": "leisure"}], "priority": 9},

            {"name": "Intermediadores de Pagamento", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "regex", "value": "(?i)pag\\*|mp\\*|picpay|mercado pago|paypal|pagseguro|sumup|cielo|rede|stone|zoop|asaas|iugu|payu|appmax"},
            ], "actions": [{"op": "set_category", "value": "shopping"}], "priority": 75},

            {"name": "Farmácia e Saúde", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "regex", "value": "(?i)farmacia|drogaria|drogasil|pague menos|venancio|sao paulo|hospital|medico|clinica|exame|laboratorio|unimed|amil|bradesco saude"},
            ], "actions": [{"op": "set_category", "value": "health"}], "priority": 10},

            {"name": "Transporte / Mobilidade", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "regex", "value": "(?i)uber|99|cabify|indriver|buser|clickbus|emtu|sptrans|metro|cptm|transport|viaca|passagem"},
            ], "actions": [{"op": "set_category", "value": "transport"}], "priority": 9},

            {"name": "Reembolso Pix", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "regex", "value": "(?i)reembolso"},
            ], "actions": [{"op": "set_category", "value": "transfers"}], "priority": 50},

            {"name": "Rendimento / Crédito em Conta", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "regex", "value": "(?i)cr.dito em conta|rendimento|juros|remuneracao da conta"},
            ], "actions": [{"op": "set_category", "value": "salary"}], "priority": 50},

            {"name": "Ferramentas e Apps Profissionais", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "regex", "value": "(?i)1password|^trae$|^trae |github|openai|chatgpt|anthropic|claude|midjourney|canva|adobe|aws|docean"},
            ], "actions": [{"op": "set_category", "value": "subscriptions"}], "priority": 8},

            {"name": "IOF de Compra Internacional", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "IOF de"},
                {"field": "description", "op": "starts_with", "value": "IOF DE"},
                {"field": "description", "op": "regex", "value": "(?i)iof.*compra|iof.*internacional"},
            ], "actions": [{"op": "set_category", "value": "taxes"}], "priority": 5},

            {"name": "Academia / Fitness", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "regex", "value": "(?i)academia|smart fit|gym|crossfit|natacao"},
            ], "actions": [{"op": "set_category", "value": "health"}], "priority": 10},

            {"name": "Hosting / Tecnologia", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "regex", "value": "(?i)hostzera|hostinger|locaweb|godaddy|hostgator|vercel|railway|netlify"},
            ], "actions": [{"op": "set_category", "value": "subscriptions"}], "priority": 10},
        ],
    },
    "US": {
        "name": "United States",
        "flag": "\U0001F1FA\U0001F1F8",
        "rules": [
            {"name": "Lyft", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "LYFT"},
            ], "actions": [{"op": "set_category", "value": "transport"}], "priority": 10},

            {"name": "DoorDash / Grubhub", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "DOORDASH"},
                {"field": "description", "op": "starts_with", "value": "GRUBHUB"},
            ], "actions": [{"op": "set_category", "value": "food"}], "priority": 10},

            {"name": "Walmart / Target / Costco", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "WALMART"},
                {"field": "description", "op": "starts_with", "value": "TARGET"},
                {"field": "description", "op": "starts_with", "value": "COSTCO"},
            ], "actions": [{"op": "set_category", "value": "groceries"}], "priority": 10},

            {"name": "Venmo / Zelle / CashApp", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "VENMO"},
                {"field": "description", "op": "contains", "value": "ZELLE"},
                {"field": "description", "op": "contains", "value": "CASH APP"},
            ], "actions": [{"op": "set_category", "value": "transfers"}], "priority": 50},

            {"name": "Starbucks / Dunkin", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "STARBUCKS"},
                {"field": "description", "op": "starts_with", "value": "DUNKIN"},
            ], "actions": [{"op": "set_category", "value": "food"}], "priority": 10},

            {"name": "Chevron / Shell / Exxon (Fuel)", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "CHEVRON"},
                {"field": "description", "op": "starts_with", "value": "SHELL"},
                {"field": "description", "op": "starts_with", "value": "EXXON"},
            ], "actions": [{"op": "set_category", "value": "transport"}], "priority": 10},

            {"name": "Whole Foods / Trader Joe's / Kroger", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "WHOLE FOODS"},
                {"field": "description", "op": "starts_with", "value": "TRADER JOE"},
                {"field": "description", "op": "starts_with", "value": "KROGER"},
            ], "actions": [{"op": "set_category", "value": "groceries"}], "priority": 10},

            {"name": "CVS / Walgreens", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "CVS"},
                {"field": "description", "op": "starts_with", "value": "WALGREENS"},
            ], "actions": [{"op": "set_category", "value": "health"}], "priority": 10},

            {"name": "T-Mobile / AT&T / Verizon", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "T-MOBILE"},
                {"field": "description", "op": "starts_with", "value": "ATT"},
                {"field": "description", "op": "starts_with", "value": "AT&T"},
                {"field": "description", "op": "starts_with", "value": "VERIZON"},
            ], "actions": [{"op": "set_category", "value": "subscriptions"}], "priority": 10},

            {"name": "Comcast / Xfinity", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "COMCAST"},
                {"field": "description", "op": "starts_with", "value": "XFINITY"},
            ], "actions": [{"op": "set_category", "value": "subscriptions"}], "priority": 10},

            {"name": "Home Depot / Lowe's", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "HOME DEPOT"},
                {"field": "description", "op": "starts_with", "value": "LOWES"},
                {"field": "description", "op": "starts_with", "value": "LOWE'S"},
            ], "actions": [{"op": "set_category", "value": "housing"}], "priority": 10},

            {"name": "Planet Fitness / YMCA", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "PLANET FITNESS"},
                {"field": "description", "op": "starts_with", "value": "YMCA"},
            ], "actions": [{"op": "set_category", "value": "health"}], "priority": 10},

            {"name": "Chipotle / McDonald's / Subway", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "CHIPOTLE"},
                {"field": "description", "op": "starts_with", "value": "MCDONALD"},
                {"field": "description", "op": "starts_with", "value": "SUBWAY"},
            ], "actions": [{"op": "set_category", "value": "food"}], "priority": 10},

            {"name": "Paycheck / Direct Deposit", "conditions_op": "and", "conditions": [
                {"field": "description", "op": "regex", "value": "PAYROLL|DIRECT DEP|ADP|GUSTO"},
            ], "actions": [{"op": "set_category", "value": "salary"}], "priority": 10},

            {"name": "Donations / Charity", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "DONATION"},
                {"field": "description", "op": "contains", "value": "CHARITY"},
                {"field": "description", "op": "contains", "value": "TITHE"},
                {"field": "description", "op": "contains", "value": "RED CROSS"},
            ], "actions": [{"op": "set_category", "value": "donations"}], "priority": 10},

            {"name": "Taxes / IRS", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "IRS"},
                {"field": "description", "op": "contains", "value": "TAX PAYMENT"},
                {"field": "description", "op": "contains", "value": "PROPERTY TAX"},
            ], "actions": [{"op": "set_category", "value": "taxes"}], "priority": 10},

            {"name": "Rent / Mortgage", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "RENT PAYMENT"},
                {"field": "description", "op": "contains", "value": "MORTGAGE"},
            ], "actions": [{"op": "set_category", "value": "housing"}], "priority": 10},
        ],
    },
    "EU": {
        "name": "Europe",
        "flag": "\U0001F1EA\U0001F1FA",
        "rules": [
            {"name": "Bolt / FreeNow", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "BOLT"},
                {"field": "description", "op": "starts_with", "value": "FREENOW"},
            ], "actions": [{"op": "set_category", "value": "transport"}], "priority": 10},

            {"name": "Deliveroo / Just Eat / Glovo", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "DELIVEROO"},
                {"field": "description", "op": "starts_with", "value": "JUST EAT"},
                {"field": "description", "op": "starts_with", "value": "GLOVO"},
            ], "actions": [{"op": "set_category", "value": "food"}], "priority": 10},

            {"name": "Lidl / Aldi / Carrefour", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "LIDL"},
                {"field": "description", "op": "starts_with", "value": "ALDI"},
                {"field": "description", "op": "starts_with", "value": "CARREFOUR"},
            ], "actions": [{"op": "set_category", "value": "groceries"}], "priority": 10},

            {"name": "SEPA Transfer", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "SEPA"},
                {"field": "description", "op": "contains", "value": "WIRE TRANSFER"},
            ], "actions": [{"op": "set_category", "value": "transfers"}], "priority": 50},

            {"name": "Wolt", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "WOLT"},
            ], "actions": [{"op": "set_category", "value": "food"}], "priority": 10},

            {"name": "Flixbus / BlaBlaCar", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "FLIXBUS"},
                {"field": "description", "op": "starts_with", "value": "BLABLACAR"},
            ], "actions": [{"op": "set_category", "value": "transport"}], "priority": 10},

            {"name": "Rossmann / DM", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "ROSSMANN"},
                {"field": "description", "op": "starts_with", "value": "DM "},
            ], "actions": [{"op": "set_category", "value": "health"}], "priority": 10},

            {"name": "IKEA", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "IKEA"},
            ], "actions": [{"op": "set_category", "value": "housing"}], "priority": 10},

            {"name": "Deutsche Bahn / SNCF / Renfe", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "DEUTSCHE BAHN"},
                {"field": "description", "op": "starts_with", "value": "DB "},
                {"field": "description", "op": "starts_with", "value": "SNCF"},
                {"field": "description", "op": "starts_with", "value": "RENFE"},
            ], "actions": [{"op": "set_category", "value": "transport"}], "priority": 10},

            {"name": "Albert Heijn / Rewe / Mercadona / Edeka", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "ALBERT HEIJN"},
                {"field": "description", "op": "starts_with", "value": "REWE"},
                {"field": "description", "op": "starts_with", "value": "MERCADONA"},
                {"field": "description", "op": "starts_with", "value": "EDEKA"},
            ], "actions": [{"op": "set_category", "value": "groceries"}], "priority": 10},

            {"name": "Miete / Loyer (Rent)", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "MIETE"},
                {"field": "description", "op": "contains", "value": "LOYER"},
            ], "actions": [{"op": "set_category", "value": "housing"}], "priority": 10},

            {"name": "Gehalt / Salaire (Salary)", "conditions_op": "and", "conditions": [
                {"field": "description", "op": "regex", "value": "GEHALT|SALAIRE|LOHN|SALARY|STIPENDIO"},
            ], "actions": [{"op": "set_category", "value": "salary"}], "priority": 10},

            {"name": "Spende / Don (Donation)", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "SPENDE"},
                {"field": "description", "op": "contains", "value": "DONATION"},
                {"field": "description", "op": "contains", "value": "DON "},
            ], "actions": [{"op": "set_category", "value": "donations"}], "priority": 10},

            {"name": "Steuer / Impôt (Tax)", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "STEUER"},
                {"field": "description", "op": "contains", "value": "IMPOT"},
                {"field": "description", "op": "contains", "value": "FINANZAMT"},
            ], "actions": [{"op": "set_category", "value": "taxes"}], "priority": 10},
        ],
    },
    "GB": {
        "name": "United Kingdom",
        "flag": "\U0001F1EC\U0001F1E7",
        "rules": [
            {"name": "Tesco / Sainsbury's / Asda", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "TESCO"},
                {"field": "description", "op": "starts_with", "value": "SAINSBURY"},
                {"field": "description", "op": "starts_with", "value": "ASDA"},
            ], "actions": [{"op": "set_category", "value": "groceries"}], "priority": 10},

            {"name": "Deliveroo / Just Eat", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "DELIVEROO"},
                {"field": "description", "op": "starts_with", "value": "JUST EAT"},
            ], "actions": [{"op": "set_category", "value": "food"}], "priority": 10},

            {"name": "TfL / Trainline", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "TFL"},
                {"field": "description", "op": "starts_with", "value": "TRAINLINE"},
            ], "actions": [{"op": "set_category", "value": "transport"}], "priority": 10},

            {"name": "Greggs / Costa / Pret", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "GREGGS"},
                {"field": "description", "op": "starts_with", "value": "COSTA"},
                {"field": "description", "op": "starts_with", "value": "PRET"},
            ], "actions": [{"op": "set_category", "value": "food"}], "priority": 10},

            {"name": "Shell / BP / Esso (Fuel)", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "SHELL"},
                {"field": "description", "op": "starts_with", "value": "BP "},
                {"field": "description", "op": "starts_with", "value": "ESSO"},
            ], "actions": [{"op": "set_category", "value": "transport"}], "priority": 10},

            {"name": "Boots / Superdrug", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "BOOTS"},
                {"field": "description", "op": "starts_with", "value": "SUPERDRUG"},
            ], "actions": [{"op": "set_category", "value": "health"}], "priority": 10},

            {"name": "Sky / BT / Virgin Media", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "SKY"},
                {"field": "description", "op": "starts_with", "value": "BT "},
                {"field": "description", "op": "starts_with", "value": "VIRGIN MEDIA"},
            ], "actions": [{"op": "set_category", "value": "subscriptions"}], "priority": 10},

            {"name": "Argos", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "ARGOS"},
            ], "actions": [{"op": "set_category", "value": "groceries"}], "priority": 10},

            {"name": "M&S", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "M&S"},
                {"field": "description", "op": "starts_with", "value": "MARKS"},
            ], "actions": [{"op": "set_category", "value": "groceries"}], "priority": 10},

            {"name": "Aldi / Lidl / Morrisons / Waitrose", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "ALDI"},
                {"field": "description", "op": "starts_with", "value": "LIDL"},
                {"field": "description", "op": "starts_with", "value": "MORRISONS"},
                {"field": "description", "op": "starts_with", "value": "WAITROSE"},
            ], "actions": [{"op": "set_category", "value": "groceries"}], "priority": 10},

            {"name": "HMRC / Council Tax", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "COUNCIL TAX"},
                {"field": "description", "op": "contains", "value": "HMRC"},
            ], "actions": [{"op": "set_category", "value": "taxes"}], "priority": 10},

            {"name": "NHS / Bupa", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "starts_with", "value": "NHS"},
                {"field": "description", "op": "starts_with", "value": "BUPA"},
            ], "actions": [{"op": "set_category", "value": "health"}], "priority": 10},

            {"name": "Salary / Wages", "conditions_op": "and", "conditions": [
                {"field": "description", "op": "regex", "value": "SALARY|WAGES|PAYROLL"},
            ], "actions": [{"op": "set_category", "value": "salary"}], "priority": 10},

            {"name": "Charity / Donation", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "CHARITY"},
                {"field": "description", "op": "contains", "value": "DONATION"},
                {"field": "description", "op": "contains", "value": "JUST GIVING"},
            ], "actions": [{"op": "set_category", "value": "donations"}], "priority": 10},

            {"name": "Rent / Mortgage", "conditions_op": "or", "conditions": [
                {"field": "description", "op": "contains", "value": "RENT"},
                {"field": "description", "op": "contains", "value": "MORTGAGE"},
                {"field": "description", "op": "contains", "value": "OPENRENT"},
            ], "actions": [{"op": "set_category", "value": "housing"}], "priority": 10},
        ],
    },
}

# Map currency code -> default rule pack country
CURRENCY_TO_PACK = {
    "BRL": "BR",
    "USD": "US",
    "EUR": "EU",
    "GBP": "GB",
}


def _resolve_category_name(internal_key: str, lang: str) -> str:
    """Resolve internal category key to the localized name."""
    data = DEFAULT_CATEGORIES_I18N.get(internal_key, {})
    return data.get(lang, data.get("en", internal_key))


def _build_rules_from_templates(templates: list[dict], categories: dict[str, str], lang: str) -> list[dict]:
    """Convert rule templates (with internal keys) to rules with resolved category UUIDs."""
    resolved = []
    for rule_data in templates:
        actions = []
        for action in rule_data["actions"]:
            if action["op"] == "set_category":
                cat_name = _resolve_category_name(action["value"], lang)
                cat_id = categories.get(cat_name)
                if not cat_id:
                    continue
                actions.append({"op": "set_category", "value": cat_id})
            else:
                actions.append(action)
        if not actions:
            continue
        resolved.append({**rule_data, "actions": actions})
    return resolved


async def _get_existing_rule_names(session: AsyncSession, user_id: uuid.UUID) -> set[str]:
    """Get the set of existing rule names for a user."""
    result = await session.execute(
        select(Rule.name).where(Rule.user_id == user_id)
    )
    return {row[0] for row in result.all()}


async def create_default_rules(session: AsyncSession, user_id: uuid.UUID, lang: str = "pt-BR") -> list[Rule]:
    """Create universal default categorization rules for a new user."""
    result = await session.execute(select(Category).where(Category.user_id == user_id))
    categories = {cat.name: str(cat.id) for cat in result.scalars().all()}

    resolved = _build_rules_from_templates(UNIVERSAL_RULES, categories, lang)

    rules = []
    for rule_data in resolved:
        rule = Rule(
            user_id=user_id,
            name=rule_data["name"],
            conditions_op=rule_data["conditions_op"],
            conditions=rule_data["conditions"],
            actions=rule_data["actions"],
            priority=rule_data["priority"],
            is_active=True,
        )
        session.add(rule)
        rules.append(rule)

    await session.commit()
    return rules


async def install_rule_pack(session: AsyncSession, user_id: uuid.UUID, pack_code: str, lang: str = "pt-BR") -> list[Rule]:
    """Install a country-specific rule pack for a user. Skips rules whose name already exists."""
    pack = RULE_PACKS.get(pack_code)
    if not pack:
        return []

    result = await session.execute(select(Category).where(Category.user_id == user_id))
    categories = {cat.name: str(cat.id) for cat in result.scalars().all()}

    resolved = _build_rules_from_templates(pack["rules"], categories, lang)

    existing_names = await _get_existing_rule_names(session, user_id)

    rules = []
    for rule_data in resolved:
        if rule_data["name"] in existing_names:
            continue
        rule = Rule(
            user_id=user_id,
            name=rule_data["name"],
            conditions_op=rule_data["conditions_op"],
            conditions=rule_data["conditions"],
            actions=rule_data["actions"],
            priority=rule_data["priority"],
            is_active=True,
        )
        session.add(rule)
        rules.append(rule)

    await session.commit()
    return rules


async def get_installed_packs(session: AsyncSession, user_id: uuid.UUID) -> dict[str, bool]:
    """Check which rule packs are fully installed for a user."""
    existing_names = await _get_existing_rule_names(session, user_id)
    result = {}
    for code, pack in RULE_PACKS.items():
        pack_names = {r["name"] for r in pack["rules"]}
        result[code] = pack_names.issubset(existing_names)
    return result


async def get_rules(session: AsyncSession, user_id: uuid.UUID) -> list[Rule]:
    result = await session.execute(
        select(Rule)
        .where(Rule.user_id == user_id)
        .order_by(Rule.priority, Rule.id)
    )
    return list(result.scalars().all())


async def get_rule(session: AsyncSession, rule_id: uuid.UUID, user_id: uuid.UUID) -> Optional[Rule]:
    result = await session.execute(
        select(Rule).where(Rule.id == rule_id, Rule.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def create_rule(session: AsyncSession, user_id: uuid.UUID, data: RuleCreate) -> Rule:
    existing_names = await _get_existing_rule_names(session, user_id)
    if data.name in existing_names:
        raise DuplicateRuleError(f"A rule named '{data.name}' already exists")

    rule = Rule(
        user_id=user_id,
        name=data.name,
        conditions_op=data.conditions_op,
        conditions=[c.model_dump() for c in data.conditions],
        actions=[a.model_dump() for a in data.actions],
        priority=data.priority,
        is_active=data.is_active,
    )
    session.add(rule)
    await session.commit()
    await session.refresh(rule)
    return rule


async def update_rule(
    session: AsyncSession, rule_id: uuid.UUID, user_id: uuid.UUID, data: RuleUpdate
) -> Optional[Rule]:
    rule = await get_rule(session, rule_id, user_id)
    if not rule:
        return None

    update_data = data.model_dump(exclude_unset=True)

    if "name" in update_data and update_data["name"] != rule.name:
        existing_names = await _get_existing_rule_names(session, user_id)
        if update_data["name"] in existing_names:
            raise DuplicateRuleError(f"A rule named '{update_data['name']}' already exists")

    if "conditions" in update_data and update_data["conditions"] is not None:
        update_data["conditions"] = [c.model_dump() for c in data.conditions]
    if "actions" in update_data and update_data["actions"] is not None:
        update_data["actions"] = [a.model_dump() for a in data.actions]

    for key, value in update_data.items():
        setattr(rule, key, value)

    await session.commit()
    await session.refresh(rule)
    return rule


async def delete_rule(session: AsyncSession, rule_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    rule = await get_rule(session, rule_id, user_id)
    if not rule:
        return False
    await session.delete(rule)
    await session.commit()
    return True


async def apply_rules_to_transaction(
    session: AsyncSession, user_id: uuid.UUID, transaction: Transaction
) -> None:
    """Apply all active rules to a transaction, modifying it in-place. Commits nothing."""
    result = await session.execute(
        select(Rule)
        .where(Rule.user_id == user_id, Rule.is_active == True)
        .order_by(Rule.priority, Rule.id)
    )
    rules = result.scalars().all()

    category_set = transaction.category_id is not None

    for rule in rules:
        conditions = rule.conditions or []
        actions = rule.actions or []
        if evaluate_conditions(rule.conditions_op, conditions, transaction):
            category_set = apply_rule_actions(actions, transaction, category_set)


async def apply_all_rules(session: AsyncSession, user_id: uuid.UUID) -> int:
    """Re-apply all active rules to all user transactions. Returns count of affected transactions."""
    from sqlalchemy import or_
    from app.models.account import Account
    from app.models.bank_connection import BankConnection

    result = await session.execute(
        select(Transaction)
        .outerjoin(Account)
        .outerjoin(BankConnection)
        .where(
            or_(
                Transaction.user_id == user_id,
                BankConnection.user_id == user_id,
            ),
            Transaction.source != "opening_balance",
        )
    )
    transactions = result.scalars().all()

    rules_result = await session.execute(
        select(Rule)
        .where(Rule.user_id == user_id, Rule.is_active == True)
        .order_by(Rule.priority, Rule.id)
    )
    rules = rules_result.scalars().all()

    count = 0
    for tx in transactions:
        # Reset to re-evaluate from scratch
        tx.category_id = None
        tx.notes = None
        category_set = False

        # --- System Pre-evaluation (Hardcoded Overrides) ---
        desc = (tx.description or "").upper()
        raw_desc = str(tx.raw_data.get("description", "") if isinstance(tx.raw_data, dict) else "").upper()
        
        target_key = None
        if "99FOOD" in desc or "99 FOOD" in desc or "99FOOD" in raw_desc or "99 FOOD" in raw_desc:
            target_key = "food"
        elif "TRANSFERÊNCIA ENVIADA" in desc or "TRANSFERENCIA ENVIADA" in desc or "GIOVANA DA SILVA LIMA" in desc or "GIOVANA DA SILVA LIMA" in raw_desc or "PIX TRANSF" in desc:
            target_key = "transfers"
        elif "99PAY" in desc or "99 PAY" in desc:
            target_key = "transfers"

        if target_key:
            cat_id = await session.scalar(
                select(Category.id).where(Category.user_id == user_id, Category.name == DEFAULT_CATEGORIES_I18N[target_key]["pt-BR"])
            )
            if cat_id:
                tx.category_id = cat_id
                category_set = True

        if not category_set:
            for rule in rules:
                conditions = rule.conditions or []
                actions = rule.actions or []
                if evaluate_conditions(rule.conditions_op, conditions, tx):
                    category_set = apply_rule_actions(actions, tx, category_set)


        # Fallback to Pluggy Map if still uncategorized
        if not category_set and tx.raw_data and isinstance(tx.raw_data, dict):
            pluggy_cat = tx.raw_data.get("category")
            if pluggy_cat:
                app_name = PLUGGY_CATEGORY_MAP.get(pluggy_cat)
                if not app_name and " - " in pluggy_cat:
                    app_name = PLUGGY_CATEGORY_MAP.get(pluggy_cat.split(" - ")[0])
                
                if app_name:
                    # Resolve category ID
                    cat_id = await session.scalar(
                        select(Category.id).where(Category.user_id == user_id, Category.name == app_name)
                    )
                    if cat_id:
                        tx.category_id = cat_id
                        category_set = True


        count += 1

    await session.commit()
    return count
async def quick_create_rule(session: AsyncSession, user_id: uuid.UUID, data: QuickRuleCreate) -> Rule:
    """Quickly create or update a rule from a transaction."""
    if not data.description.strip():
        raise ValueError("Description (match value) cannot be empty")
        
    # 1. Check if we should update an existing rule
    if data.existing_rule_id:
        rule = await get_rule(session, data.existing_rule_id, user_id)
        if not rule:
            raise ValueError("Rule not found")
        
        # Add a new 'contains' condition for the provided description
        # We assume description is what we want to match
        new_condition = {
            "field": "description",
            "op": "contains",
            "value": data.description
        }
        
        # In SQLA, we need to assign back the list to trigger change detection for JSON
        new_conditions = list(rule.conditions or [])
        new_conditions.append(new_condition)
        rule.conditions = new_conditions
        
        # Switch to 'or' if it was 'and' and we now have multiple conditions for description?
        # Actually, let's keep the user's conditions_op or set to 'or' if it makes more sense.
        # If the user is 'adding' to a rule, usually they want ANY of the descriptions to match.
        rule.conditions_op = "or"
        
        # Update category if provided
        rule.actions = [{"op": "set_category", "value": str(data.category_id)}]
        
        await session.commit()
        await session.refresh(rule)
    else:
        # Create a new rule
        # Simple name: User provided name or "Regra: [desc]"
        rule_name = data.name.strip() if data.name and data.name.strip() else f"Regra: {data.description[:30]}"
        
        # Check if name already exists
        existing = await session.execute(
            select(Rule).where(Rule.user_id == user_id, Rule.name == rule_name)
        )
        if existing.scalar_one_or_none():
            rule_name = f"{rule_name} ({uuid.uuid4().hex[:4]})"

        rule_data = RuleCreate(
            name=rule_name,
            conditions_op="or",
            conditions=[{
                "field": "description",
                "op": "contains",
                "value": data.description
            }],
            actions=[{"op": "set_category", "value": str(data.category_id)}],
            priority=10
        )
        rule = await create_rule(session, user_id, rule_data)

    if data.apply_all:
        await apply_all_rules(session, user_id)
        
    return rule

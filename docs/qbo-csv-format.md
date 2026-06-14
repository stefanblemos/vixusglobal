# Formato dos CSVs do QuickBooks Online (QBO) — spec do importador (Fase 2)

Baseado em exemplos reais: `J Monteiro Investment LLC` — Balance Sheet e Profit and Loss.

## Layout do arquivo

```
Linha 1: <Nome da empresa>,
Linha 2: <Tipo do relatório>            (ex.: "Balance Sheet", "Profit and Loss")
Linha 3: <Período>                       (BS: "As of Jan 31, 2026" | P&L: "January 1-31, 2026")
Linha 4: (vazia)
Linha 5: ,Total                          (cabeçalho das colunas; col 1 = rótulo, col 2..N = períodos)
Linha 6..: corpo (seções, contas, totais)
...
(linhas vazias)
Última: "Accrual Basis <data/hora> GMTZ",   (regime + timestamp de geração)
```

- **Sempre 2+ colunas.** Aqui só "Total"; relatórios comparativos têm várias colunas de período → o parser deve ler N colunas de valor dinamicamente a partir da linha de cabeçalho.
- A **indentação/hierarquia se perde** no CSV — a estrutura é inferida (ver abaixo).

## Parsing de números

Valores vêm como **string entre aspas** com formato US:
- Milhares com vírgula, decimal com ponto: `"234,924.19"`
- Totais frequentemente com cifrão: `"$234,924.19"`, `$0.00`
- Negativos: `"-4,000.00"`, `-$8,000.00`, `-$734.20`
- **Possível** (QBO às vezes usa) parênteses para negativo: `(1,234.00)` → tratar como `-1234.00`

Regra de limpeza: remover `"`, `$`, espaços; `(x)` → `-x`; remover vírgulas de milhar; `parseFloat`/Decimal. **Guardar como `Decimal`, nunca float.** Célula vazia = sem valor (não zero).

## Inferência de hierarquia

Não há coluna de nível. Inferir por convenção:
- **Linhas de seção** (sem valor na coluna): `Assets`, `Current Assets`, `Bank Accounts`, `Income`, `Expenses` → abrem um grupo.
- **Linhas de conta** (com valor): folhas do plano de contas. Ex.: `Bank of America - Chk - 6135 (6135),"234,924.19"`.
  - Sufixo `(6135)` = número/identificador da conta no QBO → extrair para `code` quando presente.
- **Linhas de total**: prefixo `Total for <Seção>` → fecham o grupo correspondente; usar para validar somatórios e casar com a seção aberta.
- Totais "de topo": `Total for Assets`, `Total for Liabilities and Equity` (BS deve fechar: Assets == Liabilities + Equity).

## Particularidades por relatório

- **Balance Sheet**: Assets / Liabilities / Equity. Deve fechar (Assets = Liab + Equity). No exemplo: `1.580.336,22 = -734,20 + 1.581.070,42`. ✔
- **Profit and Loss**: Income / Expenses / Net Operating Income / Net Income. `Net Income` é o resultado do período.

## ⚠️ Qualidade de dados (importante para o matching de entidades)

O **mesmo nome de empresa aparece grafado de formas diferentes** no mesmo arquivo:
- `Vixus Invetment Partners LLC` (com typo "Invetment") — linha 17
- `VixUS Investment Partners LLC` — linha 22

→ O importador **não pode casar entidades por string exata**. Precisa de:
1. Normalização (case-insensitive, remover sufixos LLC/Inc, colapsar espaços).
2. Matching aproximado (fuzzy) com **confirmação humana** antes de vincular a uma `Company`/`Party` existente.
3. Tabela de **apelidos/aliases** por entidade para "ensinar" o sistema os nomes vistos no QBO.

## Mapeamento QBO → domínio Vixus

As contas do QBO **já contêm** relações que são de primeira classe na plataforma:
- **`Loans to Others`** (ativo) → cada linha é um `IntercompanyLoan` onde a empresa é **credora**.
- **`Loan Payable to Shareholders` / outras "... LLC" em passivo** → empréstimos onde a empresa é **devedora** (e a contraparte pode ser `Party` ou `Company`).
- **`Investment - Other Companies`** (ativo) → participações → `Ownership`.
- **`Owner's Investment` / `Loan Payable to Shareholders`** (equity/passivo) → revelam os **donos (`Party`)** da empresa.

→ Na importação, oferecer **sugestões automáticas**: "detectei um empréstimo a X / participação em Y / sócio Z — deseja criar/vincular?". Sempre com confirmação.

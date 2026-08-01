# Segurança e LGPD

## Senhas

Segue o NIST SP 800-63B revisão 4, finalizada em 2025. A revisão mudou bastante
em relação ao que se costuma fazer — e o que era "senha forte" virou prática
proibida.

| O que se fazia | O que a norma diz agora |
|---|---|
| Exigir maiúscula, número e símbolo | **Proibido.** Produz senhas previsíveis do tipo `Senha123!` |
| Trocar a cada 90 dias | **Proibido.** Leva a `Verao2026`, `Verao2027` |
| Limitar a 16 caracteres | Aceitar pelo menos 64, sem truncar |
| Perguntas de segurança | Proibidas |

O que o sistema faz:

- **Mínimo de 12 caracteres**, com 15 ou mais recomendado na tela. A norma pede
  15 quando a senha é o único fator e 8 quando há segundo fator; 12 é o meio
  adotado aqui, com a recomendação visível e a verificação em duas etapas
  disponível para quem quiser o caminho da norma.
- **Nenhuma regra de composição.**
- **Sem troca periódica.** Só na suspeita de vazamento.
- **Conferência contra vazamentos conhecidos** na criação da senha, pela base
  Have I Been Pwned. Usa *k-anonymity*: só os cinco primeiros caracteres do
  hash SHA-1 saem do navegador. A senha nunca é transmitida, nem para nós nem
  para eles.
- **Aceita espaços e acentos**, contando pontos de código Unicode.

### O que este código não faz

Não guarda senha, não calcula hash de senha, não vê senha. Isso fica com o
serviço de autenticação do Supabase, que usa hash forte com salt.

A versão anterior do protótipo usava SHA-256 no próprio navegador, sem salt.
Era inaceitável para produção e foi removida — SHA-256 é rápido demais, o que
é exatamente o oposto do que se quer num hash de senha.

## Isolamento entre empresas

Cada empresa é um inquilino separado, e a separação é imposta pelo **banco**.

Toda tabela tem Row Level Security ligada. As políticas comparam a empresa da
linha com a empresa do usuário autenticado, obtida de `empresa_atual()`.

O ponto prático: alguém pode abrir as ferramentas de desenvolvimento, alterar o
JavaScript da página e tentar buscar dados de outra empresa. **O Postgres
recusa.** A segurança não está no navegador.

Confirmação rápida no SQL Editor — deve retornar 7 linhas, todas com `t`:

```sql
select relname, relrowsecurity
  from pg_class
 where relname in ('empresas','perfis','lojas','colaboradores',
                   'ausencias','escalas','registro_acoes');
```

## A chave anon

A chave `anon` fica visível no arquivo HTML, no navegador de todo mundo. **Isso
é por desenho.** Ela só identifica o projeto; quem autoriza é o JWT do usuário
autenticado, e quem filtra é a política RLS.

A chave `service_role` é outra história: ela **ignora todas as políticas RLS**.
Nunca pode entrar em código que roda no navegador. O `build/montar.py` confere
que ela não está no arquivo gerado e falha se estiver.

## Papéis

| Papel | Pode |
|---|---|
| `admin` | tudo, incluindo alterar a empresa e gerenciar acessos |
| `gestor` | montar e alterar escalas, editar equipe |
| `leitor` | apenas consultar |

Quem cria a empresa vira `admin`. Quem entra por código de convite vira
`gestor`. Use `leitor` para quem só precisa ver a escala pronta.

## Rastreabilidade

A tabela `registro_acoes` guarda quem gerou ou alterou cada escala e quando.
Atende ao dever de rastreabilidade e resolve a pergunta prática de "quem mudou
a folga da Renata".

## Dados pessoais

Nome, cargo, horário e folga de funcionário são dados pessoais sob a LGPD.

**Base legal**: execução do contrato de trabalho e cumprimento de obrigação
legal. Não é preciso pedir consentimento a cada funcionário para escalar o
trabalho dele — e consentimento seria uma base frágil aqui, já que a relação é
de subordinação.

**Providências tomadas**:

1. Região São Paulo — os dados não saem do país.
2. Acesso mínimo — papel `leitor` para quem só consulta.
3. Registro de ações — rastreabilidade de quem alterou o quê.
4. Só os dados necessários — o sistema não guarda CPF, endereço, salário nem
   documento. Nome, cargo e horário bastam para montar escala.

**O que ainda cabe a você**:

- Avisar a equipe que a escala passou a ser feita neste sistema.
- Remover o acesso de quem sai da empresa, em Authentication → Users.
- Definir por quanto tempo guardar escalas antigas. Não há expurgo automático.

## Backup

O plano gratuito do Supabase **não faz backup**. Duas saídas:

- Plano Pro, com backup diário de sete dias.
- Exportar a planilha `.xlsx` de cada competência fechada e guardar por sua
  conta.

A segunda funciona, mas depende de disciplina. A recomendação é o plano Pro
assim que o sistema virar rotina — o risco não é o custo, é ficar sem backup no
dia em que precisar dele.

## Verificação em duas etapas

Disponível em Authentication → Multi-Factor. Vale ligar ao menos para as contas
`admin`. A norma do NIST é explícita em que senha não é resistente a phishing:
é o piso da autenticação, não o teto.

# Colocar o sistema no ar

Tempo estimado: 40 minutos. Não precisa de servidor nem de cartão de crédito para começar.

---

## O que foi escolhido, e por quê

| Camada | Escolha | Motivo |
|---|---|---|
| Banco + login | **Supabase** (PostgreSQL gerenciado) | Traz autenticação, banco e regras de acesso num pacote só. O isolamento entre empresas é feito pelo próprio banco (RLS), não pelo navegador. |
| Hospedagem da página | **Cloudflare Pages** ou **Netlify** | O aplicativo é um arquivo estático. Não há servidor para manter, atualizar ou sofrer invasão. |
| Região | **São Paulo** | Latência menor e dados de funcionários ficam no Brasil, o que simplifica a LGPD. |

Considerei também Firebase e um servidor próprio com Node. O Firebase usa banco de documentos, que casa mal com dados relacionais como escala, loja e colaborador. O servidor próprio dá mais controle, mas alguém precisa cuidar de atualização de sistema, certificado e backup — trabalho recorrente que não se paga aqui.

---

## Passo 1 — Criar o projeto no Supabase

1. Entre em `supabase.com` e crie uma conta.
2. **New project**. Preencha:
   - **Name**: `escala`
   - **Database password**: gere uma longa e guarde no gerenciador de senhas. Você quase não vai usá-la.
   - **Region**: `South America (São Paulo)`
3. Espere a criação terminar (uns 2 minutos).

## Passo 2 — Criar as tabelas

1. No menu lateral, **SQL Editor** → **New query**.
2. Cole o conteúdo inteiro de `schema.sql` e clique em **Run**.
3. Deve aparecer `Success. No rows returned`.

Para conferir: em **Table Editor** devem existir 7 tabelas (`empresas`, `perfis`, `lojas`, `colaboradores`, `ausencias`, `escalas`, `registro_acoes`), todas com o cadeado de RLS ligado.

## Passo 3 — Ajustar a autenticação

Em **Authentication → Providers → Email**:

- **Enable email provider**: ligado
- **Confirm email**: ligado (impede alguém cadastrar com e-mail de outra pessoa)
- **Minimum password length**: `12`

Em **Authentication → URL Configuration**, preencha **Site URL** com o endereço final da página (o do Passo 5). Sem isso o link de recuperação de senha volta para o lugar errado.

> O envio de e-mail que já vem configurado serve para testes e tem limite baixo. Para uso real, ligue um serviço próprio em **Authentication → SMTP Settings** (Resend, Brevo e Amazon SES têm faixa gratuita suficiente).

## Passo 4 — Configurar o arquivo

Abra `escala_web.html` em um editor de texto. Nas primeiras linhas do bloco de script existe:

```js
const CONFIG = {
  SUPABASE_URL:      'COLE_AQUI_A_URL_DO_PROJETO',
  SUPABASE_ANON_KEY: 'COLE_AQUI_A_CHAVE_ANON'
};
```

Os dois valores estão em **Project Settings → API**: `Project URL` e a chave `anon public`.

A chave `anon` é pública por desenho — ela vai no navegador de todo mundo. Quem protege os dados são as políticas RLS do Passo 2. **A chave `service_role` nunca entra neste arquivo**: ela ignora todas as regras de acesso.

## Passo 5 — Publicar a página

**Cloudflare Pages** (recomendado, gratuito e sem limite de banda):

1. Crie uma pasta com o arquivo `escala_web.html` renomeado para `index.html`.
2. Em `dash.cloudflare.com` → **Workers & Pages** → **Create** → **Pages** → **Upload assets**.
3. Arraste a pasta e publique. Sai um endereço tipo `escala-abc.pages.dev`.
4. Volte ao Passo 3 e coloque esse endereço em **Site URL**.

Para usar domínio próprio (`escala.suaempresa.com.br`), é em **Custom domains** na mesma tela.

## Passo 6 — Primeiro acesso

1. Abra o endereço publicado.
2. **Criar uma conta** com seu e-mail.
3. Confirme pelo link que chegar no e-mail.
4. Ao entrar, escolha **Criar empresa** e dê o nome da rede. As duas lojas de exemplo são criadas automaticamente.
5. Vá em **Acessos** e copie o **código de convite**.

Para dar acesso aos outros gerentes: eles criam a conta pelo mesmo endereço e, quando o sistema perguntar a empresa, colam o código em vez de criar uma nova.

---

## Sobre senhas

O sistema segue o padrão NIST SP 800-63B revisão 4, de 2025, que mudou bastante em relação ao que se costumava fazer:

- **Mínimo de 12 caracteres**, com 15 ou mais recomendado na tela. Comprimento protege muito mais que complexidade.
- **Sem exigir maiúscula, número ou símbolo.** A norma passou a proibir essas regras: elas produzem senhas piores e previsíveis, do tipo `Senha123!`.
- **Sem troca periódica obrigatória.** Também proibido pela norma — leva a `Verao2026`, `Verao2027`. Troca só quando há suspeita de vazamento.
- **Conferência contra vazamentos conhecidos** na criação da senha, usando a base Have I Been Pwned. Só os cinco primeiros caracteres do hash saem do navegador, então a senha em si nunca é transmitida.
- As senhas nunca passam por este código: quem as guarda é o serviço de autenticação, com hash forte e salt.

Vale ligar a verificação em duas etapas para as contas de administrador, em **Authentication → Multi-Factor**.

---

## Custo, e a armadilha do plano gratuito

O plano gratuito atende com folga o volume de dados aqui: uma escala mensal de 20 pessoas ocupa poucos kilobytes, contra 500 MB disponíveis.

**Mas o plano gratuito tem dois problemas sérios para este uso:**

1. **O projeto é pausado depois de 7 dias sem acesso.** Como escala se monta uma vez por mês, isso vai acontecer. Reativar é manual, pelo painel.
2. **Não há backup automático.** Se algo for apagado por engano, não há de onde restaurar.

Duas saídas:

- **Plano Pro, US$ 25 por mês** — sem pausa e com backup diário de 7 dias. Para uma rede com folha de pagamento, é barato pelo que resolve.
- **Continuar no gratuito** com uma rotina externa que acesse o projeto a cada poucos dias para evitar a pausa, mais uma exportação periódica em `.xlsx` guardada por sua conta. Funciona, mas depende de disciplina.

Minha recomendação é o plano Pro assim que o sistema virar rotina. O risco não é o custo, é ficar sem o backup no dia em que precisar dele.

---

## LGPD

Nome, cargo, horário e folga de funcionário são dados pessoais. Três providências que valem a pena:

1. **Região São Paulo** no Passo 1 — os dados não saem do país.
2. **Só quem precisa tem acesso.** Use o papel `leitor` para quem apenas consulta a escala; `gestor` e `admin` para quem monta.
3. **A tabela `registro_acoes`** já guarda quem gerou ou alterou cada escala, o que atende ao dever de rastreabilidade.

O tratamento se apoia na execução do contrato de trabalho e no cumprimento de obrigação legal — não é preciso pedir consentimento a cada funcionário para escalar o trabalho dele. Ainda assim, avise a equipe que a escala passou a ser feita neste sistema.

---

## Manutenção

| Quando | O quê |
|---|---|
| Toda semana, se estiver no plano gratuito | Abrir o sistema uma vez, para não pausar |
| Todo mês | Baixar a planilha da escala fechada e guardar |
| Ao trocar de gerente | Remover o acesso antigo em Authentication → Users |
| Ao mudar o endereço da página | Atualizar Site URL nas configurações de autenticação |

A versão offline (`escala_bauru.html`) continua funcionando e não depende de internet nem de conta. Serve como plano B se o serviço estiver fora do ar no dia de fechar a escala.

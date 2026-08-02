# Publicar no GitHub

Três comandos. As credenciais nunca saem da sua máquina.

## 1. Criar o repositório

Em `github.com/new`:

- **Repository name**: `escala`
- **Private** — são dados de funcionários
- **Não marque** nenhuma das caixas de README, .gitignore ou licença: já estão
  aqui e criá-las lá causa conflito no primeiro envio

## 2. Enviar

Descompacte esta pasta, abra o terminal dentro dela e rode:

```bash
git init
git add .
git commit -m "Sistema de escala de folgas: motor, aplicativos e documentação"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/escala.git
git push -u origin main
```

Troque `SEU-USUARIO` pelo seu nome de usuário. O GitHub vai pedir autenticação
no navegador na primeira vez.

## 3. Conferir

Na aba **Actions** do repositório, o fluxo `testes` roda sozinho. Três tarefas
devem ficar verdes: motor, build e banco.

Se o motor reprovar, leia a saída: ela mostra qual limiar caiu e por quanto.

## Depois

**Proteger a branch principal** — em Settings → Branches → Add rule, para
`main`, marque "Require status checks to pass". Assim ninguém envia código que
quebra a escala.

**Configurar secrets de deploy** — em Settings → Secrets and variables → Actions,
adicione `HG_HOST`, `HG_USER`, `HG_SSH_KEY`, `HG_SSH_PASSPHRASE` e `HG_PATH`.
Com isso o workflow publica automaticamente após passar nos testes.

**Baixar os aplicativos prontos** — em cada execução do Actions, na seção
Artifacts, ficam `escala-offline.html` e `escala-web.html` montados. É de lá que
você pega o arquivo para publicar, em vez de montar na mão.

**A pasta `dist/` não vai para o repositório** de propósito: são arquivos
gerados. Quem clonar roda `python3 build/montar.py` e obtém os mesmos.

## Se preferir sem linha de comando

No GitHub, no repositório vazio, use **uploading an existing file** e arraste a
pasta inteira. Funciona, mas o `git` é melhor daqui em diante: guarda o
histórico de cada mudança de regra, que é o que interessa num sistema de escala.

# Preparar na IDE e publicar depois

## Etapa da IDE

Trabalhe no repositório existente, em uma branch de trabalho. Confira o HEAD e
as alterações locais antes de importar commits. Preserve arquivos não rastreados
e trabalho em andamento; não use `reset --hard`, `clean` ou push forçado.

Execute no terminal da IDE (no Windows, use `python` se esse for o executável):

```sh
python3 build/montar.py
python3 testes/empacotamento.py
python3 build/empacotar-hostgator.py
```

O empacotamento usa apenas a biblioteca padrão do Python. Não acessa banco ou
hospedagem, não instala arquivos no site e não ativa a manutenção na IDE.

Também confira a sintaxe do JavaScript das três variantes e os testes relevantes
do projeto. API, migrações e navegador devem rodar em ambiente isolado ou no CI:
os scripts de integração recriam bancos de teste e configuração local.

O workflow testa MySQL 5.7.44 e 8.0. Um job que não iniciou não conta como teste
aprovado. Registre o resultado real e o commit correspondente.

Durante esta etapa, envie somente a branch de trabalho e prepare o PR de revisão.
O push em `main` dispara o deploy; mantenha o merge para a etapa de publicação,
depois do preparo do banco e dos backups da instalação existente.

## Arquivos gerados em dist

| Arquivo | Uso |
|---|---|
| `publicacao-hostgator.zip` | `index.html`, quatro arquivos PHP e `.htaccess` da API |
| `preparar-manutencao.zip` | modelo de `.htaccess` da raiz, sem arquivo de ativação |
| `ativar-manutencao.zip` | modelo da raiz e arquivo `.shiftflow-manutencao`; ativa ao instalar |
| `verificar-e-migrar.sql` | atualização cumulativa de uma base existente |
| `conferir-atualizacao.sql` | conferência somente para leitura após a migração |
| `manifest-publicacao.json` | revisão observada e checksums dos pacotes/conteúdos |

O pacote da aplicação usa lista explícita de arquivos. Não inclui `api/config.php`,
logs, backups, fixtures, SQL ou arquivos de manutenção. As permissões dos arquivos
do ZIP são `0644` e as pastas são `0755`, independentemente do sistema ou umask da IDE. O timestamp UTC
adicional evita interpretar a data dos arquivos em outro fuso ao extrair.

`infra/htaccess-raiz.exemplo` contém o modelo de regras. Compare com a configuração
real antes de instalar e preserve regras específicas do servidor, inclusive de PHP.
Para manutenção, o modelo requer Apache 2.4.8 ou superior e os módulos usados pelas
regras. A resposta HTTP da página e da API precisa ser conferida na hospedagem.

O modelo permite somente as origens de Google Fonts usadas pela interface,
mantendo as demais restrições. A manutenção condicionada ao arquivo de controle
abrange subpastas com regras próprias, inclusive `api/`, e retorna HTTP 503.
Retirar o arquivo de controle reabre o site. Não versione esse arquivo de controle.

## Etapa posterior da HostGator

Uma instalação existente continua usando seu banco atual. A atualização adiciona
tabelas e colunas com `banco/verificar-e-migrar.sql`. Não substitua a base nem
reimporte o schema inicial para atualizar.

Entre os componentes adicionados estão `supervisor_lojas`, `escala_versoes`,
`migracoes_aplicadas`, descrições, jornada estruturada e colunas de versionamento.
Grades legadas são preservadas e marcadas como histórico incompleto quando faltam
snapshots. A migração não inventa participantes ou jornadas históricos.

Siga [o roteiro da instalação existente](11-atualizacao-hostgator.md): backup dos
arquivos e do banco, restauração de teste, pausa das gravações, backup final,
migração, conferência e envio dos arquivos da mesma revisão.

Configure a autoridade de plataforma em `super_admins` no `api/config.php` privado
existente. Preserve as credenciais do banco, sessão e e-mail. E-mails reais, dados
de clientes e backups não pertencem aos arquivos públicos do projeto.

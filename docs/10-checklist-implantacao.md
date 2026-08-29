# Checklist de implantação segura

## 1. Ambiente
- [ ] Definir domínio final da aplicação.
- [ ] Configurar HTTPS obrigatório.
- [ ] Garantir que o servidor/host permita o fluxo PHP e o banco MySQL.
- [ ] Definir responsável por backups e manutenção.

## 2. Banco
- [ ] Criar banco MySQL ou Supabase.
- [ ] Executar o schema correspondente.
- [ ] Confirmar índices e chaves estrangeiras.
- [ ] Criar usuários de banco com privilégios mínimos.

## 3. Autenticação
- [ ] Habilitar confirmação de e-mail.
- [ ] Exigir senhas com no mínimo 12 caracteres.
- [ ] Ativar bloqueio por tentativas de login.
- [ ] Revisar permissões por papel (`admin`, `gestor`, `leitor`, `colaborador`).

## 4. Segurança
- [ ] Manter `config.php` fora do controle de versão.
- [ ] Expor apenas o necessário via API.
- [ ] Revisar logs e auditoria regularmente.
- [ ] Remover acessos antigos de usuários que saíram.

## 5. Operação
- [ ] Testar cadastro, login, recuperação de senha e convite.
- [ ] Validar acesso por empresa.
- [ ] Verificar consumo e performance de escala.
- [ ] Guardar backup periódico das escalas fechadas.
- [ ] Confirmar que os secrets do GitHub Actions foram cadastrados.
- [ ] Confirmar que o workflow de deploy passou pelo menos uma vez.

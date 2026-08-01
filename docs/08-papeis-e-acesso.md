# Papéis e acesso

## Os quatro papéis

| Papel | Enxerga | Pode alterar |
|---|---|---|
| `admin` | tudo da empresa | tudo, incluindo papéis e acessos |
| `gestor` | tudo da empresa | equipe, parâmetros e escalas |
| `leitor` | escalas prontas | nada |
| `colaborador` | **apenas a própria escala** | nada |

Quem cria a empresa vira `admin`. Quem entra por código de convite vira
`gestor`. Quem se cadastra com um e-mail que consta na equipe vira
`colaborador`, automaticamente.

## Como o colaborador entra

1. O gestor preenche o **e-mail de acesso** da pessoa na aba Equipe.
2. A pessoa abre o endereço do sistema e cria a própria conta com aquele e-mail.
3. Ela confirma o e-mail pelo link.
4. O sistema liga a conta à ficha dela e define o papel como `colaborador`.

O e-mail confirmado é a credencial do vínculo: só quem controla a caixa postal
consegue concluir o cadastro. Não há convite separado nem senha provisória para
distribuir.

Se o e-mail não constar em nenhuma equipe, a conta fica sem empresa e a pessoa
não vê nada — não há como "adivinhar" o vínculo.

## O que o colaborador vê

A aba **Minha escala**, e só ela. Traz o nome, cargo, loja, o próprio horário,
a contagem de folgas do período, as próximas folgas e um calendário com os dias
dele.

Não traz: nome de colega, escala de colega, contagem de equipe, parâmetros,
histórico nem código de convite.

## Onde o isolamento é feito

**No servidor, em `api/minha.php`.** A linha da pessoa é extraída da grade pelo
PHP e só ela é enviada.

Isso é deliberado. Se a extração fosse feita no navegador, a grade completa
teria que ser transmitida — e bastaria abrir as ferramentas de desenvolvimento
para ler a escala de todo mundo. Esconder na tela não é esconder.

O identificador da ficha nunca vem do navegador: sai da sessão
(`usuarios.colaborador_id`). Mandar `colaborador_id` na requisição não muda
nada, e isso é testado.

## Publicação

Escala salva não é escala publicada. O colaborador só vê o que foi publicado.

Enquanto o gestor está ajustando, o rascunho fica invisível para a equipe.
Ao publicar, a data fica registrada e aparece na tela do colaborador — assim
todo mundo sabe qual versão está valendo.

## O que é testado a cada envio

`testes/api-colaborador.sh` monta duas pessoas na mesma loja com folgas em dias
diferentes e confere:

- o vínculo automático acerta a ficha certa;
- a resposta traz os 5 dias do período e as folgas exatamente nos dias dela;
- nenhum nome, id ou folga de colega aparece na resposta;
- os oito endpoints de gestão recusam o colaborador;
- mandar o id de outra ficha na requisição não surte efeito;
- escala não publicada permanece invisível;
- quem se cadastra com e-mail fora da equipe não recebe nada.

A verificação das folgas usa parser de JSON, não busca de texto: num teste de
isolamento, a diferença entre "não achei" e "não existe" importa.

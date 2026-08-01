-- =============================================================================
--  ESCALA — esquema do banco (PostgreSQL / Supabase)
--
--  Cole este arquivo inteiro no SQL Editor do Supabase e execute uma vez.
--  Ele cria as tabelas, os índices, as regras de acesso (RLS) e as funções
--  usadas pelo aplicativo.
--
--  Modelo de isolamento: cada EMPRESA é um inquilino separado. Um usuário
--  só enxerga dados da empresa a que pertence — isso é garantido pelo banco,
--  não pelo navegador. Mesmo que alguém adultere o código da página, o
--  Postgres recusa linhas de outra empresa.
-- =============================================================================

create extension if not exists pgcrypto;

-- =============================================================================
--  1. TABELAS
-- =============================================================================

create table if not exists public.empresas (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (char_length(btrim(nome)) between 2 and 120),
  codigo_convite text not null unique
                 default upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 8)),
  criado_em      timestamptz not null default now()
);

comment on column public.empresas.codigo_convite is
  'Código que o administrador passa para novos usuários entrarem na empresa.';

-- Perfil do usuário. Espelha auth.users e diz a que empresa ele pertence.
create table if not exists public.perfis (
  id         uuid primary key references auth.users(id) on delete cascade,
  empresa_id uuid references public.empresas(id) on delete set null,
  nome       text,
  papel      text not null default 'gestor'
             check (papel in ('admin', 'gestor', 'leitor')),
  criado_em  timestamptz not null default now()
);

create table if not exists public.lojas (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome       text not null check (char_length(btrim(nome)) between 1 and 80),
  parametros jsonb not null default '{}'::jsonb,
  ordem      integer not null default 0,
  criado_em  timestamptz not null default now()
);

create table if not exists public.colaboradores (
  id               uuid primary key default gen_random_uuid(),
  loja_id          uuid not null references public.lojas(id) on delete cascade,
  nome             text not null check (char_length(btrim(nome)) between 1 and 80),
  cargo            text not null default 'BALCONISTA',
  horario          text,
  gerente          boolean not null default false,
  ativo            boolean not null default true,
  folga_fixa       smallint check (folga_fixa between 0 and 6),
  primeiro_domingo date,
  dias_desde_folga smallint check (dias_desde_folga between 0 and 30),
  ordem            integer not null default 0,
  criado_em        timestamptz not null default now()
);

comment on column public.colaboradores.folga_fixa is
  'Dia da semana da folga fixa: 0=domingo ... 6=sábado. Nulo = o sistema escolhe.';
comment on column public.colaboradores.primeiro_domingo is
  'Primeiro domingo de folga. Âncora do ciclo. Nulo = o sistema distribui.';

create table if not exists public.ausencias (
  id              uuid primary key default gen_random_uuid(),
  colaborador_id  uuid not null references public.colaboradores(id) on delete cascade,
  tipo            text not null check (tipo in ('F', 'AT', 'LC', 'FC')),
  ini             date not null,
  fim             date not null,
  criado_em       timestamptz not null default now(),
  constraint periodo_valido check (fim >= ini)
);

create table if not exists public.escalas (
  id             uuid primary key default gen_random_uuid(),
  loja_id        uuid not null references public.lojas(id) on delete cascade,
  inicio         date not null,
  fim            date not null,
  grade          jsonb not null,
  parametros     jsonb,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  constraint periodo_escala_valido check (fim > inicio),
  constraint escala_unica unique (loja_id, inicio, fim)
);

comment on table public.escalas is
  'Uma escala fechada por loja e período. grade = matriz colaborador x dia.';

-- Trilha de auditoria: quem gerou ou alterou escala, e quando.
create table if not exists public.registro_acoes (
  id        bigserial primary key,
  usuario   uuid references auth.users(id) on delete set null,
  empresa_id uuid references public.empresas(id) on delete cascade,
  acao      text not null,
  detalhe   jsonb,
  em        timestamptz not null default now()
);

-- =============================================================================
--  2. ÍNDICES
-- =============================================================================

create index if not exists idx_perfis_empresa        on public.perfis (empresa_id);
create index if not exists idx_lojas_empresa         on public.lojas (empresa_id, ordem);
create index if not exists idx_colab_loja            on public.colaboradores (loja_id, ordem);
create index if not exists idx_ausencias_colab       on public.ausencias (colaborador_id);
create index if not exists idx_escalas_loja_periodo  on public.escalas (loja_id, inicio desc);
create index if not exists idx_registro_empresa      on public.registro_acoes (empresa_id, em desc);

-- =============================================================================
--  3. FUNÇÃO AUXILIAR
--  security definer para poder ler perfis sem cair em recursão de política.
-- =============================================================================

create or replace function public.empresa_atual()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select empresa_id from public.perfis where id = auth.uid();
$$;

create or replace function public.papel_atual()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select papel from public.perfis where id = auth.uid();
$$;

revoke all on function public.empresa_atual() from public;
revoke all on function public.papel_atual() from public;
grant execute on function public.empresa_atual() to authenticated;
grant execute on function public.papel_atual() to authenticated;

-- =============================================================================
--  4. CRIAÇÃO AUTOMÁTICA DO PERFIL AO CADASTRAR
-- =============================================================================

create or replace function public.ao_criar_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (id, nome)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_ao_criar_usuario on auth.users;
create trigger trg_ao_criar_usuario
  after insert on auth.users
  for each row execute function public.ao_criar_usuario();

-- =============================================================================
--  5. RPC: criar empresa / entrar por convite
--  Rodam com security definer porque precisam escrever no próprio perfil
--  antes de o usuário ter empresa.
-- =============================================================================

create or replace function public.criar_empresa(p_nome text)
returns table (empresa_id uuid, codigo_convite text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_codigo text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  if (select empresa_id from public.perfis where id = auth.uid()) is not null then
    raise exception 'Este usuário já pertence a uma empresa';
  end if;

  insert into public.empresas (nome)
  values (btrim(p_nome))
  returning id, empresas.codigo_convite into v_id, v_codigo;

  update public.perfis
     set empresa_id = v_id,
         papel      = 'admin'
   where id = auth.uid();

  insert into public.registro_acoes (usuario, empresa_id, acao, detalhe)
  values (auth.uid(), v_id, 'empresa_criada', jsonb_build_object('nome', p_nome));

  return query select v_id, v_codigo;
end;
$$;

create or replace function public.entrar_por_convite(p_codigo text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select id into v_id
    from public.empresas
   where upper(btrim(codigo_convite)) = upper(btrim(p_codigo));

  if v_id is null then
    raise exception 'Código de convite inválido';
  end if;

  update public.perfis
     set empresa_id = v_id,
         papel      = coalesce(nullif(papel, 'admin'), 'gestor')
   where id = auth.uid();

  insert into public.registro_acoes (usuario, empresa_id, acao)
  values (auth.uid(), v_id, 'entrou_por_convite');

  return v_id;
end;
$$;

grant execute on function public.criar_empresa(text)      to authenticated;
grant execute on function public.entrar_por_convite(text) to authenticated;

-- =============================================================================
--  6. RLS — o coração do isolamento entre empresas
-- =============================================================================

alter table public.empresas       enable row level security;
alter table public.perfis         enable row level security;
alter table public.lojas          enable row level security;
alter table public.colaboradores  enable row level security;
alter table public.ausencias      enable row level security;
alter table public.escalas        enable row level security;
alter table public.registro_acoes enable row level security;

-- --- empresas -----------------------------------------------------------
drop policy if exists empresa_le on public.empresas;
create policy empresa_le on public.empresas
  for select to authenticated
  using (id = public.empresa_atual());

drop policy if exists empresa_edita on public.empresas;
create policy empresa_edita on public.empresas
  for update to authenticated
  using (id = public.empresa_atual() and public.papel_atual() = 'admin')
  with check (id = public.empresa_atual());

-- --- perfis -------------------------------------------------------------
drop policy if exists perfil_proprio on public.perfis;
create policy perfil_proprio on public.perfis
  for select to authenticated
  using (id = auth.uid() or empresa_id = public.empresa_atual());

drop policy if exists perfil_atualiza_proprio on public.perfis;
create policy perfil_atualiza_proprio on public.perfis
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists perfil_admin_gerencia on public.perfis;
create policy perfil_admin_gerencia on public.perfis
  for update to authenticated
  using (empresa_id = public.empresa_atual() and public.papel_atual() = 'admin')
  with check (empresa_id = public.empresa_atual());

-- --- lojas --------------------------------------------------------------
drop policy if exists loja_le on public.lojas;
create policy loja_le on public.lojas
  for select to authenticated
  using (empresa_id = public.empresa_atual());

drop policy if exists loja_escreve on public.lojas;
create policy loja_escreve on public.lojas
  for all to authenticated
  using (empresa_id = public.empresa_atual() and public.papel_atual() in ('admin', 'gestor'))
  with check (empresa_id = public.empresa_atual());

-- --- colaboradores ------------------------------------------------------
drop policy if exists colab_le on public.colaboradores;
create policy colab_le on public.colaboradores
  for select to authenticated
  using (exists (
    select 1 from public.lojas l
     where l.id = colaboradores.loja_id
       and l.empresa_id = public.empresa_atual()
  ));

drop policy if exists colab_escreve on public.colaboradores;
create policy colab_escreve on public.colaboradores
  for all to authenticated
  using (exists (
    select 1 from public.lojas l
     where l.id = colaboradores.loja_id
       and l.empresa_id = public.empresa_atual()
       and public.papel_atual() in ('admin', 'gestor')
  ))
  with check (exists (
    select 1 from public.lojas l
     where l.id = colaboradores.loja_id
       and l.empresa_id = public.empresa_atual()
  ));

-- --- ausências ----------------------------------------------------------
drop policy if exists ausencia_le on public.ausencias;
create policy ausencia_le on public.ausencias
  for select to authenticated
  using (exists (
    select 1 from public.colaboradores c
      join public.lojas l on l.id = c.loja_id
     where c.id = ausencias.colaborador_id
       and l.empresa_id = public.empresa_atual()
  ));

drop policy if exists ausencia_escreve on public.ausencias;
create policy ausencia_escreve on public.ausencias
  for all to authenticated
  using (exists (
    select 1 from public.colaboradores c
      join public.lojas l on l.id = c.loja_id
     where c.id = ausencias.colaborador_id
       and l.empresa_id = public.empresa_atual()
       and public.papel_atual() in ('admin', 'gestor')
  ))
  with check (exists (
    select 1 from public.colaboradores c
      join public.lojas l on l.id = c.loja_id
     where c.id = ausencias.colaborador_id
       and l.empresa_id = public.empresa_atual()
  ));

-- --- escalas ------------------------------------------------------------
drop policy if exists escala_le on public.escalas;
create policy escala_le on public.escalas
  for select to authenticated
  using (exists (
    select 1 from public.lojas l
     where l.id = escalas.loja_id
       and l.empresa_id = public.empresa_atual()
  ));

drop policy if exists escala_escreve on public.escalas;
create policy escala_escreve on public.escalas
  for all to authenticated
  using (exists (
    select 1 from public.lojas l
     where l.id = escalas.loja_id
       and l.empresa_id = public.empresa_atual()
       and public.papel_atual() in ('admin', 'gestor')
  ))
  with check (exists (
    select 1 from public.lojas l
     where l.id = escalas.loja_id
       and l.empresa_id = public.empresa_atual()
  ));

-- --- registro de ações --------------------------------------------------
drop policy if exists registro_le on public.registro_acoes;
create policy registro_le on public.registro_acoes
  for select to authenticated
  using (empresa_id = public.empresa_atual());

drop policy if exists registro_insere on public.registro_acoes;
create policy registro_insere on public.registro_acoes
  for insert to authenticated
  with check (empresa_id = public.empresa_atual());

-- =============================================================================
--  7. ATUALIZAÇÃO DE CARIMBO DE TEMPO
-- =============================================================================

create or replace function public.marcar_atualizacao()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_escala_atualizada on public.escalas;
create trigger trg_escala_atualizada
  before update on public.escalas
  for each row execute function public.marcar_atualizacao();

-- =============================================================================
--  Fim. Depois de executar, confira em Authentication > Providers que
--  "Email" está ligado e "Confirm email" está marcado.
-- =============================================================================

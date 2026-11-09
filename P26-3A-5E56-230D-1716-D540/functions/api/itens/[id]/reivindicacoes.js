/**
 * POST /api/itens/:id/reivindicacoes — logado e não autor. Corpo { mensagem } (10–500 chars).
 * Ordem das checagens: 401 → 415/400 (JSON) → 404 item → 403 próprio item → 400 mensagem →
 * 409 item não aberto → 409 já tem reivindicação ativa.
 * Grava contato_autor = username do autor e contato_reivindicante = username do reivindicante.
 * 201 { reivindicacao: Reivindicacao }.
 */
import { ehViolacaoUnica, exigirUsuario, falha, idDaRota, json, lerJson, porMetodo } from "../../../_lib/http.js";
import { validarReivindicacao } from "../../../_lib/validacao.js";
import { buscarItem, buscarReivindicacao, serializarReivindicacao } from "../../../_lib/repositorio.js";

async function criar(context) {
  const usuario = exigirUsuario(context);
  const { env, params, request } = context;
  const id = idDaRota(params.id);
  const corpo = await lerJson(request);

  const item = await buscarItem(env, id);
  if (!item) throw falha.naoEncontrado("Item não encontrado.");
  if (item.autor_id === usuario.user_id) throw falha.semPermissao("Você não pode reivindicar o próprio item.");
  const v = validarReivindicacao(corpo);
  if (!v.ok) throw falha.invalido("Mensagem inválida.", v.erros);
  if (item.status !== "aberto") throw falha.conflito("Este item não está aberto para reivindicações.");

  let novo;
  try {
    // Insere só se o item continua aberto e não é do usuário (condição e escrita na mesma instrução).
    novo = await env.DB.prepare(
      `INSERT INTO reivindicacoes (item_id, reivindicante_id, mensagem, status, contato_autor, contato_reivindicante)
       SELECT i.id, ur.user_id, ?, 'pendente', ua.username, ur.username
         FROM itens i
         JOIN usuarios ua ON ua.user_id = i.autor_id
         JOIN usuarios ur ON ur.user_id = ?
        WHERE i.id = ? AND i.status = 'aberto' AND i.autor_id <> ?
       RETURNING id`,
    )
      .bind(v.valor.mensagem, usuario.user_id, id, usuario.user_id)
      .first();
  } catch (e) {
    if (ehViolacaoUnica(e)) throw falha.conflito("Você já tem uma reivindicação ativa neste item.");
    throw e;
  }
  if (!novo) throw falha.conflito("Este item não está mais aberto para reivindicações.");

  const linha = await buscarReivindicacao(env, novo.id);
  return json({ reivindicacao: serializarReivindicacao(linha, usuario.user_id) }, 201);
}

export const onRequest = porMetodo({ POST: criar });

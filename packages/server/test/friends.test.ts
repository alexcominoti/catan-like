import { describe, expect, it } from 'vitest';
import { decideFriendRequest, type FriendEdge } from '../src/friends.js';

const A = 'user-a';
const B = 'user-b';

describe('decideFriendRequest (núcleo puro)', () => {
  it('sem arestas: cria um novo pedido', () => {
    expect(decideFriendRequest([], A, B)).toEqual({ action: 'create' });
  });

  it('não deixa adicionar a si mesmo', () => {
    const d = decideFriendRequest([], A, A);
    expect(d.action).toBe('noop');
  });

  it('pedido recíproco pendente → aceita o existente (auto-aceite)', () => {
    const edges: FriendEdge[] = [{ requesterId: B, addresseeId: A, status: 'pending' }];
    expect(decideFriendRequest(edges, A, B)).toEqual({ action: 'accept-existing' });
  });

  it('pedido já enviado por mim → noop', () => {
    const edges: FriendEdge[] = [{ requesterId: A, addresseeId: B, status: 'pending' }];
    const d = decideFriendRequest(edges, A, B);
    expect(d).toEqual({ action: 'noop', reason: 'Pedido já enviado.' });
  });

  it('já são amigos (qualquer direção) → noop', () => {
    expect(decideFriendRequest([{ requesterId: A, addresseeId: B, status: 'accepted' }], A, B).action).toBe('noop');
    expect(decideFriendRequest([{ requesterId: B, addresseeId: A, status: 'accepted' }], A, B).action).toBe('noop');
  });

  it('bloqueado → noop', () => {
    expect(decideFriendRequest([{ requesterId: B, addresseeId: A, status: 'blocked' }], A, B).action).toBe('noop');
  });
});

import { describe, expect, it } from 'vitest';
import { shouldStartMatch, botsToAdd, DEFAULT_TUNING } from '../src/matchmaking.js';

const T = DEFAULT_TUNING;

describe('shouldStartMatch (núcleo do matchmaking)', () => {
  it('mesa cheia de humanos começa na hora', () => {
    expect(shouldStartMatch(T.target, 0)).toBe(true);
  });

  it('gente suficiente + espera mínima → começa (completa com bots)', () => {
    expect(shouldStartMatch(T.minHumans, T.startDelayMs - 1)).toBe(false);
    expect(shouldStartMatch(T.minHumans, T.startDelayMs)).toBe(true);
  });

  it('só 1 humano espera até o teto e então começa com bots', () => {
    expect(shouldStartMatch(1, T.startDelayMs)).toBe(false); // < minHumans, ainda espera
    expect(shouldStartMatch(1, T.maxWaitMs - 1)).toBe(false);
    expect(shouldStartMatch(1, T.maxWaitMs)).toBe(true);
  });

  it('sala vazia nunca começa', () => {
    expect(shouldStartMatch(0, T.maxWaitMs * 10)).toBe(false);
  });
});

describe('botsToAdd', () => {
  it('completa até o alvo', () => {
    expect(botsToAdd(1, 0, 4)).toBe(3);
    expect(botsToAdd(2, 0, 4)).toBe(2);
    expect(botsToAdd(2, 1, 4)).toBe(1);
    expect(botsToAdd(4, 0, 4)).toBe(0);
    expect(botsToAdd(3, 2, 4)).toBe(0); // já passou do alvo: não adiciona negativo
  });
});

import { describe, it, expect } from 'vitest';
import { normalizeName, generateAliases, extractMentions, removeAccents } from './normalize.js';

describe('removeAccents', () => {
  it('remove diacríticos', () => {
    expect(removeAccents('Desenvolvimento Ágil')).toBe('Desenvolvimento Agil');
  });
});

describe('normalizeName', () => {
  it('gera slug minúsculo com hífens', () => {
    expect(normalizeName('Squad Desenvolvimento')).toBe('squad-desenvolvimento');
  });
  it('remove caracteres especiais', () => {
    expect(normalizeName('Claude Code!! @#$')).toBe('claude-code');
  });
  it('colapsa hífens e espaços', () => {
    expect(normalizeName('  QA   --  Time ')).toBe('qa-time');
  });
});

describe('generateAliases', () => {
  it('gera aliases para agente', () => {
    const aliases = generateAliases('Claude Code', 'agent');
    expect(aliases).toContain('claude-code');
    expect(aliases).toContain('claude');
    expect(aliases).toContain('agent-claude-code');
  });

  it('gera atalho squad-dev', () => {
    const aliases = generateAliases('Squad Desenvolvimento', 'squad');
    expect(aliases).toContain('squad-desenvolvimento');
    expect(aliases).toContain('squad-desenvolvimento');
    expect(aliases).toContain('desenvolvimento');
  });
});

describe('extractMentions', () => {
  it('extrai menções normalizadas de um texto', () => {
    expect(extractMentions('cria issue para @claude e @squad-dev agora')).toEqual([
      'claude',
      'squad-dev',
    ]);
  });
  it('retorna vazio quando não há menção', () => {
    expect(extractMentions('sem mencao aqui')).toEqual([]);
  });
});

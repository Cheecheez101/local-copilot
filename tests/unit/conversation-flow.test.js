'use strict';

const { ConversationFlow } = require('../../src/core/conversation-flow');

describe('ConversationFlow', () => {
  let flow;

  beforeEach(() => {
    flow = new ConversationFlow();
  });

  it('starts file exploration at ask_path', () => {
    const state = flow.manageFlow('FILE_EXPLORATION', {});
    expect(state.step).toBe('ask_path');
    expect(state.nextSteps).toEqual(['list_files', 'offer_actions', 'execute_choice']);
  });

  it('advances file exploration next step when path is provided', () => {
    const next = flow.flows.FILE_EXPLORATION.next('ask_path', 'C:\\Users\\Administrator');
    expect(next).toBe('list_files');
  });

  it('falls back to default flow for unknown intent', () => {
    const state = flow.manageFlow('WHATEVER', {});
    expect(state.step).toBe('understand');
    expect(state.nextSteps).toEqual(['respond']);
  });
});

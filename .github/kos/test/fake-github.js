'use strict';
// A tiny in-memory stand-in for the octokit client that actions/github-script
// provides. Only the calls the board scripts make are implemented.

function makeIssue(number, { labels = [], assignees = [], body = '', title = `Task ${number}`, state = 'open' } = {}) {
  return { number, title, body, state, labels: new Set(labels), assignees: new Set(assignees), pull_request: undefined };
}

function view(issue) {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    labels: [...issue.labels].map((name) => ({ name })),
    assignees: [...issue.assignees].map((login) => ({ login })),
    html_url: `https://github.com/o/r/issues/${issue.number}`,
  };
}

function fakeGithub({ issues = [], permissions = {}, reviews = [] } = {}) {
  const store = new Map(issues.map((i) => [i.number, i]));
  const comments = []; // { issue_number, body }
  const find = (n) => {
    const i = store.get(n);
    if (!i) {
      const e = new Error('Not Found');
      e.status = 404;
      throw e;
    }
    return i;
  };
  const github = {
    __store: store,
    __comments: comments,
    __dispatched: [],
    paginate: async (fn, params) => (await fn(params)).data,
    rest: {
      issues: {
        get: async ({ issue_number }) => ({ data: view(find(issue_number)) }),
        createComment: async ({ issue_number, body }) => {
          comments.push({ issue_number, body });
          return { data: { body } };
        },
        addLabels: async ({ issue_number, labels }) => {
          const i = find(issue_number);
          labels.forEach((l) => i.labels.add(l));
          return { data: [] };
        },
        removeLabel: async ({ issue_number, name }) => {
          const i = find(issue_number);
          if (!i.labels.has(name)) {
            const e = new Error('Label does not exist');
            e.status = 404;
            throw e;
          }
          i.labels.delete(name);
          return { data: [] };
        },
        update: async ({ issue_number, body, state }) => {
          const i = find(issue_number);
          if (body !== undefined) i.body = body;
          if (state) i.state = state;
          return { data: view(i) };
        },
        addAssignees: async ({ issue_number, assignees }) => {
          const i = find(issue_number);
          assignees.forEach((a) => i.assignees.add(a));
          return { data: view(i) };
        },
        removeAssignees: async ({ issue_number, assignees }) => {
          const i = find(issue_number);
          assignees.forEach((a) => i.assignees.delete(a));
          return { data: view(i) };
        },
        listForRepo: async ({ state = 'open', labels, assignee }) => {
          const data = [...store.values()]
            .filter((i) => state === 'all' || i.state === state)
            .filter((i) => !labels || labels.split(',').every((l) => i.labels.has(l)))
            .filter((i) => !assignee || i.assignees.has(assignee))
            .map(view);
          return { data };
        },
      },
      repos: {
        getCollaboratorPermissionLevel: async ({ username }) => ({ data: { permission: permissions[username] || 'read' } }),
      },
      pulls: {
        listReviews: async () => ({ data: reviews }),
      },
      actions: {
        createWorkflowDispatch: async (params) => {
          github.__dispatched.push(params);
          return { data: null };
        },
      },
    },
  };
  return github;
}

const core = {
  info: () => {},
  warning: () => {},
  summary: { addHeading() { return this; }, addRaw() { return this; }, write: async () => {} },
};

function context({ issue, comment, pull_request, action }) {
  return {
    repo: { owner: 'o', repo: 'r' },
    payload: { issue: issue && view(issue), comment, pull_request, action },
  };
}

module.exports = { makeIssue, fakeGithub, core, context, view };

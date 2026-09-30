import { requestUrl } from 'obsidian';

export interface GitHubField {
    id: string;
    name: string;
    type: string;
    options?: { id: string; name: string; color?: string; description?: string }[];
}

export interface GitHubItem {
    id: string;
    contentId: string;
    contentType: 'DraftIssue' | 'Issue' | 'PullRequest';
    title: string;
    body: string;
    url?: string;
    status: string;
    archived: boolean;
    fields: Record<string, string | number>;
    assignees?: string[];
    subIssues?: { completed: number; total: number };
    issueState?: 'OPEN' | 'CLOSED';
    parentIssueId?: string;
    issueNumber?: number;
    closedAt?: string | null;
    createdAt?: string;
    updatedAt?: string;
    labels?: string[];
    milestone?: string;
    issueType?: string;
}

export interface GitHubProjectSnapshot {
    id: string;
    title: string;
    url: string;
    fields: GitHubField[];
    items: GitHubItem[];
}

type Connection<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };

interface FieldNode { id: string; name: string; dataType: string; options?: { id: string; name: string; color?: string; description?: string }[];
    multiSelectOptions?: { id: string; name: string; color?: string }[];
    configuration?: { iterations: { id: string; title: string }[]; completedIterations: { id: string; title: string }[] } }
interface ItemNode {
    id: string;
    isArchived: boolean;
    content: { __typename: GitHubItem['contentType']; id: string; title: string; body?: string; url?: string;
        assignees?: { nodes: { login: string }[] }; subIssuesSummary?: { completed: number; total: number };
        state?: 'OPEN' | 'CLOSED'; parent?: { id: string } | null;
        number?: number; closedAt?: string | null; createdAt?: string; updatedAt?: string;
        labels?: { nodes: { name: string }[] }; milestone?: { title: string } | null;
        issueType?: { name: string } | null } | null;
    fieldValues: { nodes: ({ __typename: string; name?: string; title?: string; text?: string; number?: number; date?: string; value?: string;
        field?: { name: string }; users?: { nodes: { login: string }[] }; pullRequests?: { nodes: { number: number }[] } } | null)[] };
}
interface ProjectNode {
    id: string;
    title: string;
    url: string;
    fields: Connection<FieldNode>;
    items: Connection<ItemNode>;
}

export function parseGitHubProjectUrl(value: string): { owner: string; number: number; kind: 'user' | 'organization' } {
    const match = value.trim().match(/^https:\/\/github\.com\/(users|orgs)\/([A-Za-z\d-]+)\/projects\/(\d+)\/?(?:\?.*)?$/i);
    if (!match) throw new Error('Expected a GitHub Projects URL: https://github.com/users/OWNER/projects/NUMBER');
    return { owner: match[2]!, number: Number(match[3]), kind: match[1] === 'orgs' ? 'organization' : 'user' };
}

export function parseGitHubRepositoryUrl(value: string): { owner: string; name: string } {
    const match = value.trim().match(/^https:\/\/github\.com\/([A-Za-z\d-]+)\/([A-Za-z\d_.-]+)\/?$/i);
    if (!match) throw new Error('Expected a repository URL: https://github.com/OWNER/REPOSITORY');
    return { owner: match[1]!, name: match[2]! };
}

const PROJECT_QUERY = `query ProjectSync($owner: String!, $number: Int!, $after: String) {
  user(login: $owner) { projectV2(number: $number) { ...ProjectData } }
}
fragment ProjectData on ProjectV2 {
  id title url
  fields(first: 100) { nodes {
    ... on ProjectV2Field { id name dataType }
    ... on ProjectV2SingleSelectField { id name dataType options { id name color description } }
    ... on ProjectV2MultiSelectField { id name dataType multiSelectOptions { id name color } }
    ... on ProjectV2IterationField { id name dataType configuration { iterations { id title } completedIterations { id title } } }
  } pageInfo { hasNextPage endCursor } }
  items(first: 100, after: $after, archivedStates: [ARCHIVED, NOT_ARCHIVED]) {
    nodes { id isArchived content {
      __typename
      ... on DraftIssue { id title body }
      ... on Issue { id title body url state number closedAt createdAt updatedAt parent { id }
        assignees(first: 100) { nodes { login } } labels(first: 100) { nodes { name } }
        milestone { title } issueType { name } subIssuesSummary { completed total } }
      ... on PullRequest { id title body url assignees(first: 10) { nodes { login } } }
    } fieldValues(first: 50) { nodes {
      __typename
      ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldIterationValue { title field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldMultiSelectValue { value field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldUserValue { users(first: 10) { nodes { login } } field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldPullRequestValue { pullRequests(first: 10) { nodes { number } } field { ... on ProjectV2FieldCommon { name } } }
    } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const ORG_PROJECT_QUERY = PROJECT_QUERY.replace('user(login: $owner)', 'organization(login: $owner)');

export class GitHubProjectsClient {
    constructor(private token: string) {}

    private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
        const response = await requestUrl({
            url: 'https://api.github.com/graphql',
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.token}`,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query, variables }),
            throw: false
        });
        let parsed: { data?: T; errors?: { message: string }[]; message?: string };
        try {
            const raw: unknown = response.json;
            if (!raw || typeof raw !== 'object') throw new Error('Invalid JSON');
            parsed = raw as typeof parsed;
        }
        catch { throw new Error(`GitHub returned HTTP ${response.status}`); }
        if (response.status >= 400 || parsed.errors?.length || !parsed.data) {
            throw new Error(parsed.errors?.map(error => error.message).join('; ') || parsed.message || `GitHub returned HTTP ${response.status}`);
        }
        return parsed.data;
    }

    async loadProject(url: string): Promise<GitHubProjectSnapshot> {
        const reference = parseGitHubProjectUrl(url);
        const query = reference.kind === 'organization' ? ORG_PROJECT_QUERY : PROJECT_QUERY;
        let cursor: string | null = null;
        const items: GitHubItem[] = [];
        let project: ProjectNode | undefined;
        do {
            const data: { user?: { projectV2?: ProjectNode }; organization?: { projectV2?: ProjectNode } } =
                await this.graphql(query, { owner: reference.owner, number: reference.number, after: cursor });
            project = data.user?.projectV2 || data.organization?.projectV2;
            if (!project) throw new Error('GitHub Project was not found or the token cannot access it.');
            for (const node of project.items.nodes || []) {
                if (!node?.content || !['DraftIssue', 'Issue', 'PullRequest'].includes(node.content.__typename)) continue;
                const fields: Record<string, string | number> = {};
                for (const value of node.fieldValues.nodes || []) {
                    if (!value?.field?.name) continue;
                    const raw = value.name ?? value.title ?? value.value ?? value.text ?? value.number ?? value.date ??
                        value.users?.nodes.filter(Boolean).map(user => user.login).join(', ') ??
                        value.pullRequests?.nodes.filter(Boolean).map(pr => `#${pr.number}`).join(', ');
                    if (raw !== undefined && raw !== null) fields[value.field.name] = raw;
                }
                items.push({
                    id: node.id, contentId: node.content.id, contentType: node.content.__typename,
                    title: node.content.title, body: node.content.body || '', url: node.content.url,
                    status: String(fields.Status || ''), archived: node.isArchived, fields,
                    assignees: node.content.assignees?.nodes.filter(Boolean).map(user => user.login),
                    subIssues: node.content.subIssuesSummary, issueState: node.content.state,
                    parentIssueId: node.content.parent?.id, issueNumber: node.content.number,
                    closedAt: node.content.closedAt, createdAt: node.content.createdAt,
                    updatedAt: node.content.updatedAt,
                    labels: node.content.labels?.nodes.filter(Boolean).map(label => label.name),
                    milestone: node.content.milestone?.title, issueType: node.content.issueType?.name
                });
            }
            cursor = project.items.pageInfo.hasNextPage ? project.items.pageInfo.endCursor : null;
        } while (cursor);
        if (!project) throw new Error('GitHub Project was not found.');
        if (project.fields.pageInfo.hasNextPage) throw new Error('This project has more than 100 fields; field pagination is required.');
        return {
            id: project.id, title: project.title, url: project.url, items,
            fields: project.fields.nodes.filter((field): field is FieldNode => Boolean(field?.id)).map(field => ({
                id: field.id, name: field.name, type: field.dataType,
                options: field.options || field.multiSelectOptions ||
                    field.configuration?.iterations.concat(field.configuration.completedIterations)
                        .map(iteration => ({ id: iteration.id, name: iteration.title }))
            }))
        };
    }

    async createDraft(projectId: string, title: string, body: string): Promise<string> {
        const data = await this.graphql<{ addProjectV2DraftIssue: { projectItem: { id: string } } }>(
            'mutation($input: AddProjectV2DraftIssueInput!) { addProjectV2DraftIssue(input: $input) { projectItem { id } } }',
            { input: { projectId, title, body } }
        );
        return data.addProjectV2DraftIssue.projectItem.id;
    }

    async createChecklistDraft(projectId: string, title: string, body: string): Promise<{ itemId: string; contentId: string }> {
        const data = await this.graphql<{ addProjectV2DraftIssue: { projectItem: { id: string; content: { id: string } } } }>(
            'mutation($input: AddProjectV2DraftIssueInput!) { addProjectV2DraftIssue(input: $input) { projectItem { id content { ... on DraftIssue { id } } } } }',
            { input: { projectId, title, body } }
        );
        const item = data.addProjectV2DraftIssue.projectItem;
        return { itemId: item.id, contentId: item.content.id };
    }

    async updateDraftBody(draftIssueId: string, body: string): Promise<void> {
        await this.graphql(
            'mutation($input: UpdateProjectV2DraftIssueInput!) { updateProjectV2DraftIssue(input: $input) { draftIssue { id } } }',
            { input: { draftIssueId, body } }
        );
    }

    async updateIssueBody(issueId: string, body: string): Promise<void> {
        await this.graphql(
            'mutation($input: UpdateIssueInput!) { updateIssue(input: $input) { issue { id } } }',
            { input: { id: issueId, body } }
        );
    }

    async repositoryId(url: string): Promise<string> {
        const { owner, name } = parseGitHubRepositoryUrl(url);
        const data = await this.graphql<{ repository: { id: string; hasIssuesEnabled: boolean } | null }>(
            'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id hasIssuesEnabled } }',
            { owner, name }
        );
        if (!data.repository) throw new Error(`Repository ${owner}/${name} was not found or the token cannot access it.`);
        if (!data.repository.hasIssuesEnabled) throw new Error(`Issues are disabled in ${owner}/${name}.`);
        return data.repository.id;
    }

    async createIssue(repositoryId: string, projectId: string, title: string, body: string,
        parentIssueId?: string): Promise<{ id: string; url: string; itemId: string }> {
        const data = await this.graphql<{ createIssue: { issue: { id: string; url: string;
            projectItems: { nodes: { id: string; project: { id: string } }[] } } } }>(
            'mutation($input: CreateIssueInput!) { createIssue(input: $input) { issue { id url projectItems(first: 20) { nodes { id project { id } } } } } }',
            { input: { repositoryId, title, body, parentIssueId, projectV2Ids: [projectId] } }
        );
        const issue = data.createIssue.issue;
        const item = issue.projectItems.nodes.find(node => node.project.id === projectId);
        if (item) return { id: issue.id, url: issue.url, itemId: item.id };
        try {
            const itemId = await this.addIssueToProject(projectId, issue.id);
            return { id: issue.id, url: issue.url, itemId };
        } catch (error) {
            const linked = await this.findIssueProjectItem(issue.id, projectId);
            if (linked) return { id: issue.id, url: issue.url, itemId: linked };
            throw new Error(`Issue ${issue.url} was created but could not be linked to the Project. Add it manually before retrying: ${String(error)}`);
        }
    }

    private async findIssueProjectItem(issueId: string, projectId: string): Promise<string | undefined> {
        const data = await this.graphql<{ node: { projectItems: { nodes: { id: string; project: { id: string } }[] } } | null }>(
            'query($issueId: ID!) { node(id: $issueId) { ... on Issue { projectItems(first: 100) { nodes { id project { id } } } } } }',
            { issueId }
        );
        return data.node?.projectItems.nodes.find(item => item.project.id === projectId)?.id;
    }

    async addIssueToProject(projectId: string, contentId: string): Promise<string> {
        const data = await this.graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
            'mutation($input: AddProjectV2ItemByIdInput!) { addProjectV2ItemById(input: $input) { item { id } } }',
            { input: { projectId, contentId } }
        );
        return data.addProjectV2ItemById.item.id;
    }

    async convertDraftToIssue(itemId: string, repositoryId: string): Promise<{ itemId: string; issueId: string; url: string }> {
        const data = await this.graphql<{ convertProjectV2DraftIssueItemToIssue: {
            item: { id: string; content: { id: string; url: string } }
        } }>(
            'mutation($input: ConvertProjectV2DraftIssueItemToIssueInput!) { convertProjectV2DraftIssueItemToIssue(input: $input) { item { id content { ... on Issue { id url } } } } }',
            { input: { itemId, repositoryId } }
        );
        const item = data.convertProjectV2DraftIssueItemToIssue.item;
        return { itemId: item.id, issueId: item.content.id, url: item.content.url };
    }

    async addSubIssue(parentIssueId: string, issueId: string): Promise<void> {
        await this.graphql(
            'mutation($input: AddSubIssueInput!) { addSubIssue(input: $input) { subIssue { id } } }',
            { input: { issueId: parentIssueId, subIssueId: issueId } }
        );
    }

    async setIssueClosed(issueId: string, closed: boolean): Promise<void> {
        if (closed) await this.graphql(
            'mutation($input: CloseIssueInput!) { closeIssue(input: $input) { issue { id } } }',
            { input: { issueId } }
        );
        else await this.graphql(
            'mutation($input: ReopenIssueInput!) { reopenIssue(input: $input) { issue { id } } }',
            { input: { issueId } }
        );
    }

    async createStageField(projectId: string, stages: string[]): Promise<GitHubField> {
        const data = await this.graphql<{ createProjectV2Field: { projectV2Field: FieldNode } }>(
            'mutation($input: CreateProjectV2FieldInput!) { createProjectV2Field(input: $input) { projectV2Field { ... on ProjectV2SingleSelectField { id name dataType options { id name color description } } } } }',
            { input: { projectId, name: 'Этап', dataType: 'SINGLE_SELECT',
                singleSelectOptions: stages.map(name => ({ name, color: 'GRAY', description: '' })) } }
        );
        const field = data.createProjectV2Field.projectV2Field;
        if (!field?.id || !field.options) throw new Error('GitHub did not create the stage field.');
        return { id: field.id, name: field.name, type: field.dataType, options: field.options };
    }

    async ensureStageOptions(field: GitHubField, stages: string[]): Promise<GitHubField> {
        const existing = field.options || [];
        const missing = stages.filter(stage => !existing.some(option => option.name === stage));
        if (!missing.length) return field;
        const options = [
            ...existing.map(option => ({ id: option.id, name: option.name,
                color: option.color || 'GRAY', description: option.description || '' })),
            ...missing.map(name => ({ name, color: 'GRAY', description: '' }))
        ];
        const data = await this.graphql<{ updateProjectV2Field: { projectV2Field: FieldNode } }>(
            'mutation($input: UpdateProjectV2FieldInput!) { updateProjectV2Field(input: $input) { projectV2Field { ... on ProjectV2SingleSelectField { id name dataType options { id name color description } } } } }',
            { input: { fieldId: field.id, singleSelectOptions: options } }
        );
        const updated = data.updateProjectV2Field.projectV2Field;
        if (!updated?.options) throw new Error('GitHub did not update the stage options.');
        return { id: updated.id, name: updated.name, type: updated.dataType, options: updated.options };
    }

    async updateTitle(item: GitHubItem, title: string): Promise<void> {
        if (item.contentType === 'DraftIssue') {
            await this.graphql('mutation($input: UpdateProjectV2DraftIssueInput!) { updateProjectV2DraftIssue(input: $input) { draftIssue { id } } }',
                { input: { draftIssueId: item.contentId, title } });
        } else if (item.contentType === 'Issue') {
            await this.graphql('mutation($input: UpdateIssueInput!) { updateIssue(input: $input) { issue { id } } }',
                { input: { id: item.contentId, title } });
        } else {
            await this.graphql('mutation($input: UpdatePullRequestInput!) { updatePullRequest(input: $input) { pullRequest { id } } }',
                { input: { pullRequestId: item.contentId, title } });
        }
    }

    async updateStatus(projectId: string, itemId: string, fieldId: string, optionId: string): Promise<void> {
        await this.graphql('mutation($input: UpdateProjectV2ItemFieldValueInput!) { updateProjectV2ItemFieldValue(input: $input) { projectV2Item { id } } }',
            { input: { projectId, itemId, fieldId, value: { singleSelectOptionId: optionId } } });
    }

    async updateCustomField(projectId: string, itemId: string, field: GitHubField, raw: string | number): Promise<void> {
        if (raw === '') {
            await this.graphql('mutation($input: ClearProjectV2ItemFieldValueInput!) { clearProjectV2ItemFieldValue(input: $input) { projectV2Item { id } } }',
                { input: { projectId, itemId, fieldId: field.id } });
            return;
        }
        let value: Record<string, unknown>;
        if (field.type === 'TEXT') value = { text: String(raw) };
        else if (field.type === 'NUMBER') {
            const parsed = Number(raw);
            if (!Number.isFinite(parsed)) throw new Error(`${field.name} must be a number.`);
            value = { number: parsed };
        } else if (field.type === 'DATE') {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) throw new Error(`${field.name} must be YYYY-MM-DD.`);
            value = { date: String(raw) };
        } else if (field.type === 'SINGLE_SELECT') {
            const option = field.options?.find(option => option.name === String(raw));
            if (!option) throw new Error(`Option not found for ${field.name}: ${raw}`);
            value = { singleSelectOptionId: option.id };
        } else if (field.type === 'ITERATION') {
            const option = field.options?.find(option => option.name === String(raw));
            if (!option) throw new Error(`Iteration not found for ${field.name}: ${raw}`);
            value = { iterationId: option.id };
        } else if (field.type === 'MULTI_SELECT') {
            const names = String(raw).split(',').map(name => name.trim()).filter(Boolean);
            const ids = names.map(name => field.options?.find(option => option.name === name)?.id);
            if (ids.some(id => !id)) throw new Error(`Option not found for ${field.name}: ${raw}`);
            value = { multiSelectOptionIds: ids };
        } else throw new Error(`Editing ${field.type} is not available for ${field.name}.`);
        await this.graphql('mutation($input: UpdateProjectV2ItemFieldValueInput!) { updateProjectV2ItemFieldValue(input: $input) { projectV2Item { id } } }',
            { input: { projectId, itemId, fieldId: field.id, value } });
    }

    async setArchived(projectId: string, itemId: string, archived: boolean): Promise<void> {
        if (archived) {
            await this.graphql('mutation($input: ArchiveProjectV2ItemInput!) { archiveProjectV2Item(input: $input) { item { id } } }',
                { input: { projectId, itemId } });
        } else {
            await this.graphql('mutation($input: UnarchiveProjectV2ItemInput!) { unarchiveProjectV2Item(input: $input) { item { id } } }',
                { input: { projectId, itemId } });
        }
    }
}

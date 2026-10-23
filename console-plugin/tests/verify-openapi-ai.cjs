// Deterministic browser contract test: real Registry draft lifecycle + controlled proposals.
// Never calls a model. Creates/deletes only uniquely named ai-poc artifacts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.POC_REGISTRY_API || 'http://localhost:8080/apis/registry/v3';
const ui = process.env.POC_AI_EDITOR_BASE_URL || 'http://localhost:8888/explore/ai-poc/';
const out = path.resolve(process.env.POC_EVIDENCE_DIR || 'console-plugin/.runtime/openapi-ai');
fs.mkdirSync(out, { recursive: true });
async function api(route, init) {
    const response = await fetch(base + route, { ...init, signal: AbortSignal.timeout(15000) });
    assert(response.ok, `Registry ${response.status} for ${route}`);
    return response;
}
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const created = [], results = [], errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    // Enable the opt-in UI configuration for this browser only. Preserve the host's config.js.
    await page.route('**/config.js', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()) +
            '\nApicurioRegistryConfig.ui.openApiAssistantUrl="/openapi-assistant/proposals";' });
    });
    const proposal = async route => {
        const body = route.request().postDataJSON();
        requests.push(body);
        const yaml = body.draft.contentType.includes('yaml');
        const candidate = yaml ? body.draft.content.replace(/title: [^\n]+/, 'title: AI candidate') :
            JSON.stringify({ ...JSON.parse(body.draft.content), info: { ...JSON.parse(body.draft.content).info, title: 'AI candidate' } });
        await route.fulfill({ json: { ...body.draft, requestId: body.requestId, status: 'applicable', candidate,
            diff: [{ kind: 'changed', path: '/info/title', before: 'Source current', after: 'AI candidate', schemaDifferences: [] }], diagnostics: [] } });
    };
    await page.route('**/openapi-assistant/proposals', proposal);
    const title = () => page.locator('#property-title');
    const save = () => page.locator('#section-context').getByRole('button', { name: 'Save', exact: true });
    const waitTitle = value => page.waitForFunction(v => document.querySelector('#property-title')?.value === v, value);
    const check = value => { results.push(value); console.log(value); };
    try {
        // Check the existing isolated fixture read-only; never touch default or baseline groups.
        const fixtureBefore = await (await api('/groups/ai-poc/artifacts/inventory-api/versions/1/content')).text();
        for (const format of ['json', 'yaml']) {
            const id = `g5-${format}-${Date.now()}`;
            const original = format === 'json' ? JSON.stringify({ openapi: '3.0.3', info: { title: 'Original', version: '1' }, paths: {} }) :
                "# Exact pre-AI YAML\nopenapi: 3.0.3\ninfo:\n  title: Original\n  version: '1'\npaths: {}\n";
            await api('/groups/ai-poc/artifacts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ artifactId: id, artifactType: 'OPENAPI', firstVersion: { version: '1', isDraft: true,
                    content: { content: original, contentType: format === 'json' ? 'application/json' : 'application/x-yaml' } } }) });
            created.push(id);
            await page.goto(ui + id + '/versions/1/editor');
            await title().waitFor({ timeout: 60000 }); await waitTitle('Original');
            assert(await save().isDisabled());
            await page.getByRole('button', { name: 'Open AI assistant', exact: true }).click();
            await page.getByRole('textbox', { name: 'Assistant instruction' }).fill('Change title');
            await page.locator('#source-mode').click();
            await page.locator('.monaco-editor textarea').waitFor({ timeout: 60000 });
            await page.evaluate(() => {
                const model = window.monaco.editor.getModels().find(m => m.getLanguageId() === 'json');
                const value = JSON.parse(model.getValue()); value.info.title = 'Source current'; model.setValue(JSON.stringify(value, null, 2));
            });
            const count = requests.length;
            await page.getByRole('button', { name: 'Propose', exact: true }).click();
            await page.getByRole('status').filter({ hasText: 'Source or a visual field' }).waitFor();
            assert.equal(requests.length, count, 'unapplied Source never sent');
            await page.waitForFunction(() => document.querySelector('.source-form button.pf-m-primary')?.disabled === false);
            await page.locator('.source-form').getByRole('button', { name: 'Save', exact: true }).click();
            await page.locator('#design-mode').click(); await waitTitle('Source current');
            await page.getByRole('button', { name: 'Propose', exact: true }).click();
            await page.getByRole('button', { name: 'Apply to draft', exact: true }).waitFor();
            assert(requests.at(-1).draft.content.includes('Source current'));
            assert.equal(requests.at(-1).draft.baseHash, require('node:crypto').createHash('sha256').update(requests.at(-1).draft.content).digest('hex'));
            assert(requests.at(-1).draft.documentId.includes(id));
            const preAI = requests.at(-1).draft.content;
            assert.equal(await (await api(`/groups/ai-poc/artifacts/${id}/versions/1/content`)).text(), original);
            await page.getByRole('button', { name: 'Apply to draft', exact: true }).click(); await waitTitle('AI candidate');
            assert(await save().isEnabled());
            assert(await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), 'AI replacement resets prior history');
            assert.equal(await (await api(`/groups/ai-poc/artifacts/${id}/versions/1/content`)).text(), original, 'Apply does not persist');
            await title().fill('After AI'); await title().press('Tab'); await waitTitle('After AI');
            await page.getByRole('button', { name: 'Undo', exact: true }).click(); await waitTitle('AI candidate');
            await page.getByRole('button', { name: 'Redo', exact: true }).click(); await waitTitle('After AI');
            await page.getByRole('button', { name: 'Restore pre-AI draft', exact: true }).click(); await waitTitle('Source current');
            // Requesting again proves exact restoration of the pre-AI serialized draft.
            await page.getByRole('button', { name: 'Propose', exact: true }).click();
            await page.getByRole('button', { name: 'Apply to draft', exact: true }).waitFor();
            assert.equal(requests.at(-1).draft.content, preAI);
            await page.getByRole('button', { name: 'Apply to draft', exact: true }).click(); await waitTitle('AI candidate');
            await save().click(); await page.waitForFunction(() => document.querySelector('#section-context button.pf-m-primary')?.disabled);
            const saved = await (await api(`/groups/ai-poc/artifacts/${id}/versions/1/content`)).text();
            assert(saved.includes('AI candidate')); if (format === 'yaml') assert(saved.includes('title:'));
            await page.reload(); await title().waitFor({ timeout: 60000 }); await waitTitle('AI candidate'); assert(await save().isDisabled());
            check(`${format}: Source blocked/current draft hashed; Apply draft-only; history reset; new undo/redo; exact restore; explicit save/reload`);
        }
        assert.equal(await (await api('/groups/ai-poc/artifacts/inventory-api/versions/1/content')).text(), fixtureBefore);
        assert.deepEqual(errors, []);
        check('Existing ai-poc/inventory-api unchanged; no page errors');
        await page.screenshot({ path: path.join(out, 'g5-final.png'), fullPage: true });
    } catch (error) {
        await page.screenshot({ path: path.join(out, 'g5-failure.png'), fullPage: true });
        console.error((await page.locator('body').innerText()).slice(0, 5000));
        throw error;
    } finally {
        fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify({ results, errors, requestCount: requests.length, created }, null, 2));
        await browser.close();
        for (const id of created) {
            assert(id.startsWith('g5-'));
            await api(`/groups/ai-poc/artifacts/${id}`, { method: 'DELETE' });
        }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });

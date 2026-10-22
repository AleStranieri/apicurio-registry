const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = path.resolve(process.env.POC_EVIDENCE_DIR || path.join(__dirname, '../.runtime/apitomy-poc'));
fs.mkdirSync(out, { recursive: true });
const base=process.env.POC_REGISTRY_API || 'http://localhost:8080/apis/registry/v3';
const ui=process.env.POC_EDITOR_BASE_URL || (process.env.POC_CONSOLE_URL || 'http://localhost:9000')+'/apicurio/ns/default/simple/explore/default/';
const fixture=process.env.POC_FIXTURE_ID || '08257cf4-fa65-4257-badf-066832b88a66';
async function api(path,opts){const r=await fetch(base+path,opts);assert(r.ok,`${r.status} ${await r.clone().text()}`);return r;}
(async()=>{
 const before=await (await api(`/groups/default/artifacts/${fixture}/versions/1/content`)).text();
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1600,height:1100}});const errors=[],requests=[],results=[],workers=[],external=[];const created=[];
 page.on('worker',worker=>workers.push(worker.url()));
 page.on('request',request=>{if(/jsdelivr|unpkg/.test(request.url()))external.push(request.url())});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400)requests.push({url:r.url(),status:r.status()});});
 const check=message=>{results.push(message);console.log(message)};
 const save=()=>page.locator('#section-context').getByRole('button',{name:'Save',exact:true});
 const title=()=>page.locator('#property-title');
 async function load(id,expected){await page.goto(ui+id+'/versions/1/editor'); await title().waitFor({timeout:60000});await page.waitForFunction(v=>document.querySelector('#property-title')?.value===v,expected); assert(await save().isDisabled(),'initially clean');}
 async function edit(value){await title().fill(value);await title().press('Tab');await page.waitForFunction(()=>document.querySelector('#section-context button.pf-m-primary')?.disabled===false);}
 try{
  for(const format of ['json','yaml']){
   const id=`apitomy-poc-${format}-${Date.now()}`;
   const originalTitle=`Apitomy ${format} original`;
   const obj={openapi:'3.0.2',info:{title:originalTitle,version:'1.0.0'},paths:{}};
   const content=format==='json'?JSON.stringify(obj):`# YAML fixture\nopenapi: 3.0.2\ninfo:\n  title: ${originalTitle}\n  version: 1.0.0\npaths: {}\n`;
   await api('/groups/default/artifacts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({artifactId:id,artifactType:'OPENAPI',firstVersion:{version:'1',isDraft:true,content:{content,contentType:format==='json'?'application/json':'application/x-yaml'}}})});created.push(id);
   await load(id,originalTitle);check(`${format}: clean initial load`);
   await edit(`${originalTitle} edited`); assert(await save().isEnabled());
   await page.getByRole('button',{name:'Undo',exact:true}).click();await page.waitForFunction(v=>document.querySelector('#property-title')?.value===v,originalTitle);assert(await save().isDisabled());
   await page.getByRole('button',{name:'Redo',exact:true}).click();await page.waitForFunction(v=>document.querySelector('#property-title')?.value===v,`${originalTitle} edited`);check(`${format}: edit, undo to clean, redo`);
   await save().click();await page.waitForFunction(()=>document.querySelector('#section-context button.pf-m-primary')?.disabled);assert(await save().isDisabled());
   const saved=await (await api(`/groups/default/artifacts/${id}/versions/1/content`)).text();assert(saved.includes(`${originalTitle} edited`)); if(format==='yaml')assert(saved.includes('title:'));
   assert(await page.getByRole('button',{name:'Undo',exact:true}).isEnabled());check(`${format}: save and preserved undo`);
   await load(id,`${originalTitle} edited`);check(`${format}: reload saved content`);
   await edit(`${originalTitle} unsaved`);
   await page.getByRole('button',{name:'Previous editor',exact:true}).click();const frame=page.frameLocator('#openapi-editor-frame');await frame.getByText(`${originalTitle} unsaved`,{exact:false}).first().waitFor({timeout:60000});check(`${format}: legacy fallback receives unsaved edits`);
   await page.getByRole('button',{name:'Apitomy (preview)',exact:true}).click();await title().waitFor();assert.equal(await title().inputValue(),`${originalTitle} unsaved`);assert(await save().isEnabled());check(`${format}: return from fallback preserves unsaved edits`);
   // Reload with unsaved content and exercise Registry recovery.
   await page.reload();await page.getByRole('button',{name:'Restore local changes',exact:true}).click();
   await page.waitForFunction(v=>document.querySelector('#property-title')?.value===v,`${originalTitle} unsaved`);
   assert(await save().isEnabled());await save().click();await page.waitForFunction(()=>document.querySelector('#section-context button.pf-m-primary')?.disabled);check(`${format}: recovery restores unsaved edits`);
   await page.locator('#source-mode').click();await page.locator('.monaco-editor textarea').waitFor({timeout:60000});
   assert.equal(await page.evaluate(()=>window.monaco.editor.getModels().length)>0,true);
   const source=await page.evaluate(()=>window.monaco.editor.getModels().map(m=>m.getValue()).join('\n'));assert(source.includes(`${originalTitle} unsaved`));
   await page.screenshot({path:path.join(out, `${format}-source.png`),fullPage:true});check(`${format}: Source Monaco rendered`);
   if(format==='yaml'){
    await page.locator('#yaml-toggle').click();await page.waitForFunction(()=>window.monaco.editor.getModels().some(m=>m.getLanguageId()==='yaml'));
    await page.locator('#json-toggle').click();
   }
   await page.waitForFunction(()=>window.monaco.editor.getModels().some(m=>m.getLanguageId()==='json'&&m.getValue().trim().startsWith('{')));
   await page.evaluate(newTitle=>{const model=window.monaco.editor.getModels().find(m=>m.getLanguageId()==='json');const value=JSON.parse(model.getValue());if(value.info)value.info.title=newTitle;else value.title=newTitle;model.setValue(JSON.stringify(value,null,2));},`${originalTitle} source`);
   await page.waitForFunction(()=>document.querySelector('.source-form button.pf-m-primary')?.disabled===false);
   await page.locator('.source-form').getByRole('button',{name:'Save',exact:true}).click();
   await page.locator('#design-mode').click();await title().waitFor();
   await page.waitForFunction(v=>document.querySelector('#property-title')?.value===v,`${originalTitle} source`);
   await save().click();await page.waitForFunction(()=>document.querySelector('#section-context button.pf-m-primary')?.disabled);
   await load(id,`${originalTitle} source`);check(`${format}: Source edit, apply, Registry save, reload`);
  }
  // Navigate between documents through the embedded SPA, preserving the JS runtime.
  await page.evaluate(()=>window.__apitomyRouteMarker='same-runtime');
  await page.getByRole('tab',{name:'Drafts',exact:true}).click();
  await page.locator('#drafts-list > li').filter({hasText:created[0]}).locator('[data-testid^="draft-actions-dropdown-"]').click();
  await page.getByText('Edit draft',{exact:true}).click();
  await title().waitFor();await page.waitForFunction(()=>document.querySelector('#property-title')?.value==='Apitomy json original source');
  assert(await save().isDisabled());assert(await page.getByRole('button',{name:'Undo',exact:true}).isDisabled());
  assert.equal(await page.evaluate(()=>window.__apitomyRouteMarker),'same-runtime');check('SPA document change clears prior model and undo history');
  // Check the original fixture and capture the finished layout without changing it.
  await load(fixture,'Pet Store API');
  assert.equal(errors.length,0);assert.equal(external.length,0);assert(workers.length>0,'Monaco worker must run');check('local Monaco workers and no external CDN');
  const bounds=await page.locator('.apitomy-openapi-editor').boundingBox();assert(bounds.height>400&&bounds.y+bounds.height<=1101,`bounds: ${JSON.stringify(bounds)}`);
  await page.screenshot({path:path.join(out, 'apitomy-okd.png'),fullPage:true});
  assert.equal(await(await api(`/groups/default/artifacts/${fixture}/versions/1/content`)).text(),before);check('original Pet Store fixture unchanged');
 }catch(e){await page.screenshot({path:path.join(out, 'failure.png'),fullPage:true});console.error(e);console.error((await page.locator('body').innerText()).slice(-7000));process.exitCode=1;}
 finally{
  fs.writeFileSync(path.join(out, 'browser-report.json'),JSON.stringify({results,errors,requests,created,workers,external},null,2));console.log(JSON.stringify({results,errors,workerCount:workers.length,external,backgroundErrors:requests.filter(r=>!r.url.includes('/api/kubernetes/')&&!r.url.includes('/api/console/')&&!r.url.includes('/api/olm/'))},null,2));
  await browser.close();
  for(const id of created){assert(id.startsWith('apitomy-poc-'));await api(`/groups/default/artifacts/${id}`,{method:'DELETE'});}
 }
})().catch(e=>{console.error(e);process.exitCode=1});

async (page) => {
  const assert=(ok,label)=>{if(!ok)throw Error(label);};
  const close=()=>page.locator('#moment-dialog [data-m-action="close"]').click();
  const open=name=>page.evaluate(name=>FocoMoments.open(name),name);
  const result=[];
  await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('foco_moments_')).forEach(k=>localStorage.removeItem(k)));
  await page.reload();
  await page.locator('#nav-sugerencias').click();
  await open('Rescue');
  await page.evaluate(()=>auditData.events.find(e=>e.id==='late').title='Cambio desde otra pestaña');
  await page.locator('[data-m-action="apply-rescue"]').click();
  await page.getByText('La actividad cambió desde que abriste',{exact:false}).waitFor();
  assert(await page.evaluate(()=>auditWrites.every(w=>!w.ids.length)),'Concurrent edit overwritten');
  await close();
  result.push('Concurrent edit detected');
  await page.evaluate(()=>auditFailure={table:'events',mode:'select'});
  await open('Rescue');
  await page.locator('[data-m-action="retry"]').click();
  await page.locator('[data-rescue="0"]').waitFor();
  await close();
  result.push('Loading error and retry');
  // Empty history, zero pending, and zero achievements must be honest states.
  await page.evaluate(()=>{window.savedEvents=auditData.events;auditData.events=[];});
  for(const mode of ['Rescue','Time','Insights','Close','Capsule']){
    await open(mode);
    if(mode==='Rescue')assert((await page.locator('#moment-body').innerText()).includes('No quedan actividades'),'Empty rescue');
    if(mode==='Time'){await page.locator('[data-m-action="recommend"]').click();assert((await page.locator('#moment-body').innerText()).includes('No hay pendientes'),'Empty time');}
    if(mode==='Insights')assert((await page.locator('#moment-body').innerText()).includes('Todavía no hay datos'),'Empty insight');
    if(mode==='Close'||mode==='Capsule'){await page.locator('[data-m-action="save-memory"]').click();assert((await page.locator('#moment-status').innerText()).includes('Escribí un logro'),'Blank memory saved');}
    await close();
  }
  await page.evaluate(()=>auditData.events=savedEvents);
  result.push('Five empty states');
  // Failed AI keeps the raw text; manual review does not invent a date.
  await page.route('**/api/claude',route=>route.fulfill({status:503,body:'unavailable'}));
  await open('Capture');
  await page.locator('#moment-brain').fill('Primera idea\nSegunda idea');
  await page.locator('[data-m-action="organize"]').click();
  await page.locator('#moment-title-1').waitFor();
  assert(await page.locator('#moment-date-0').inputValue()==='','Fallback invented dates');
  assert((await page.locator('#moment-status').innerText()).includes('no pudo ordenarla'),'Fallback not explained');
  await close();
  await page.unroute('**/api/claude');
  result.push('AI failure keeps manually editable draft');
  // Cancellation during a slow read-only AI request must not affect a newly opened dialog.
  await open('Capture');await page.locator('[data-m-action="edit-capture"]').click();
  await page.route('**/api/claude',async route=>{await new Promise(r=>setTimeout(r,800));try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({content:[{text:'{"activities":[{"title":"Late response"}]}'}]})});}catch{}});
  await page.locator('[data-m-action="organize"]').click();
  await close();await open('Time');
  await page.locator('[data-m-action="recommend"]').click();
  await page.waitForTimeout(1100);
  assert(await page.locator('#moment-title').innerText()==='Tengo un rato','Late response replaced dialog');
  assert(await page.locator('.mom-result').count()===1,'Late response altered content');
  await close();await page.unroute('**/api/claude');
  result.push('AI request cancellable; stale response ignored');
  // Reopen under another user: no prior user's private draft.
  await page.evaluate(()=>{currentUser={id:'other-user'};FocoMoments.resetSession();});
  await open('Capture');assert(await page.locator('#moment-brain').inputValue()==='','Draft leaked across users');await close();
  await page.evaluate(()=>currentUser={id:'audit-user'});
  result.push('Per-user storage isolation');
  // Markup-like titles are literal text, and native dialog contains focus.
  await page.evaluate(()=>{auditData.events.find(e=>e.id==='short').title='<img src=x onerror="window.badMoment=true">'+'x'.repeat(250);});
  await open('Rescue');
  assert(await page.locator('.mom-rescue-row img').count()===0,'Title parsed as markup');
  await page.keyboard.press('Tab');
  assert(await page.evaluate(()=>!!document.activeElement.closest('#moment-dialog')),'Focus left modal');
  await page.keyboard.press('Escape');
  assert(!await page.locator('#moment-dialog').isVisible(),'Escape did not close');
  assert(!await page.evaluate(()=>window.badMoment),'XSS');
  result.push('Escaped titles, focus containment, Escape');
  await page.evaluate(()=>{setLanguage('en');localStorage.removeItem('foco_moments_audit-user_capture');});
  const titles={Rescue:'Rescue my day',Time:'I have a little time',Capture:'Clear my head',Close:'Close my day',Insights:'What works for you',Capsule:'Weekly capsule'};
  for(const [mode,title] of Object.entries(titles)){await open(mode);assert(await page.locator('#moment-title').innerText()===title,'English title '+mode);await close();}
  result.push('Six dialogs in English');
  assert((await page.evaluate(()=>momentErrors)).length===0,'JS errors '+await page.evaluate(()=>momentErrors.join(' | ')));
  return {result,errors:[]};
}

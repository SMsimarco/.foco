async (page) => {
  await page.context().addInitScript(() => {
    localStorage.setItem('foco-lang','es');
    localStorage.setItem('foco-onboarding-done','1');
    window.momentErrors=[];window.addEventListener('error',e=>window.momentErrors.push(e.message));
    window.addEventListener('unhandledrejection',e=>window.momentErrors.push(String(e.reason)));
  });
  await page.context().route('**/vendor/supabase.js', route => route.fulfill({status:200,contentType:'application/javascript',path:'tests/momentos/mock-supabase.js'}));
  await page.context().route('**/api/claude', async route => {
    const req=route.request().postDataJSON();
    let reply={headline:'Un paso a la vez',insight:'Elegí una tarea concreta.',tip:'Dale espacio a lo importante.'};
    if(req.system.includes('Extraé actividades'))reply={activities:[{title:'Pagar internet',date:null,start:null,end:null},{title:'Llamar a mamá',date:null,start:null,end:null}]};
    if(req.system.includes('primer paso concreto'))reply={step:'Abrí el borrador y elegí los tres puntos que querés incluir.'};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({content:[{text:JSON.stringify(reply)}]})});
  });
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://localhost:3000');
  await page.locator('#nav-sugerencias').click();
  await page.locator('[data-m-action="rescue"]').click();
  await page.locator('[data-rescue="0"]').waitFor();
  return {body:await page.locator('#moment-body').innerText(),errors:await page.evaluate(()=>window.momentErrors)};
}

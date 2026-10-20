async (page) => {
  await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('foco_moments_')).forEach(k=>localStorage.removeItem(k)));
  await page.reload();
  await page.locator('#nav-sugerencias').click();
  const shots=[], checks=[];
  const close=()=>page.locator('#moment-dialog [data-m-action="close"]').click();
  for(const width of [390,1280]){
    await page.setViewportSize({width,height:844});
    for(const theme of ['dark','light']){
      await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
      for(const view of ['sugerencias','equipo']){
        await page.locator('#nav-'+view).click();
        await page.waitForFunction(view=>currentView===view,view);
        await page.locator('#view-'+view).evaluate(el=>el.scrollTop=0);
        await page.waitForTimeout(300);
        if(view==='equipo')await page.locator('#moment-progress').waitFor();
        await page.screenshot({animations:'disabled',path:`output/playwright/moments-${width}-${theme}-${view}.png`});
        shots.push(`${width}-${theme}-${view}`);
      }
      for(const mode of ['Rescue','Time','Capture','Close','Insights','Capsule']){
        await page.evaluate(name=>FocoMoments.open(name),mode);
        if(mode==='Time'){await page.locator('[data-energy="High"]').click();await page.locator('[data-m-action="recommend"]').click();}
        if(mode==='Capture'){
          if(await page.locator('[data-m-action="edit-capture"]').count())await page.locator('[data-m-action="edit-capture"]').click();
          await page.locator('#moment-brain').fill('Pagar internet\nLlamar a mamá');
          await page.locator('[data-m-action="organize"]').click();
          await page.locator('#moment-title-1').waitFor();
          await page.locator('[data-m-action="date-today"][data-index="0"]').click();
          await page.locator('[data-m-action="date-tomorrow"][data-index="1"]').click();
        }
        if(mode==='Close'||mode==='Capsule'){
          await page.locator('#moment-achievement').fill(mode==='Close'?'Le di tiempo a lo importante':'Terminé la propuesta de mi proyecto');
          await page.locator('#moment-learn').fill('Un bloque corto me ayuda a empezar.');
          await page.locator('#moment-next').fill('Preparar tres ideas para la próxima reunión');
        }
        await page.evaluate(()=>document.getElementById('moment-dialog').scrollTop=0);
        await page.screenshot({animations:'disabled',path:`output/playwright/moments-${width}-${theme}-${mode.toLowerCase()}.png`});
        const state=await page.evaluate(()=>{
          const d=document.getElementById('moment-dialog');return {overflow:d.scrollWidth>d.clientWidth+1,smallButtons:[...d.querySelectorAll('button')].filter(el=>el.getBoundingClientRect().height<44).map(el=>el.textContent),pageOverflow:document.documentElement.scrollWidth>innerWidth};
        });
        if(state.overflow||state.pageOverflow||state.smallButtons.length)throw Error(`${width}/${theme}/${mode}: ${JSON.stringify(state)}`);
        shots.push(`${width}-${theme}-${mode}`);checks.push(`${width}/${theme}/${mode}`);
        if(mode==='Capsule'&&width===390&&theme==='light'){
          await page.locator('[data-m-action="save-memory"]').click();
          const dlPromise=page.waitForEvent('download');await page.locator('[data-m-action="download"]').click();
          await (await dlPromise).saveAs('output/playwright/moments-capsule-card.png');
        }
        await close();
      }
    }
  }
  await page.evaluate(()=>setLanguage('en'));
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>FocoMoments.open('Capsule'));
  await page.screenshot({animations:'disabled',path:'output/playwright/moments-390-light-english.png'});await close();
  await page.setViewportSize({width:1280,height:900});
  await page.evaluate(()=>{document.body.style.zoom='2';});
  await page.evaluate(()=>FocoMoments.open('Time'));
  await page.locator('[data-m-action="recommend"]').click();
  await page.screenshot({animations:'disabled',path:'output/playwright/moments-zoom200.png'});
  if(await page.evaluate(()=>{const d=document.getElementById('moment-dialog');return d.scrollWidth>d.clientWidth+1;}))throw Error('Zoom overflow');
  await close();await page.evaluate(()=>{document.body.style.zoom='';setLanguage('es');});
  return {shots:shots.length,checks,errors:await page.evaluate(()=>momentErrors)};
}

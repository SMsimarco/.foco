window.supabase = {createClient: () => {
  const uid = 'audit-user';
  const date = n => { const d = new Date(); d.setDate(d.getDate()+n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const event = (id,title,offset,start,end,done=false) => ({id,user_id:uid,title,date:date(offset),start_time:start,end_time:end,done,recurrente:false,dia_semana:null,is_focus:false});
  window.auditData = {
    events: [event('done','Leer un capítulo',0,'08:00','08:20',true),event('short','Enviar propuesta de diseño',0,'09:00','09:20'),event('long','Diseñar la nueva experiencia de clientes',0,'10:00','11:30'),event('loose','Ordenar las ideas del proyecto y revisar los comentarios del equipo',0,null,null),event('late','Comprar materiales para el taller',0,'17:00','18:00'),{...event('routine','Estiramientos',-5,'07:00','07:15'),recurrente:true},event('tomorrow','Preparar reunión del equipo',1,'09:00','10:00'),
      ...Array.from({length:20},(_,i)=>event('history'+i,'Actividad de ejemplo',-1-Math.floor(i/2),i%2?'15:00':'09:00',i%2?'16:00':'09:20',i%2?i<5:true))],
    profiles:[{id:uid,display_name:'Alex',onboarding_completed:true}],daily_checkins:[{id:'d',user_id:uid,date:date(0),energy:4}],evening_checkins:[{id:'c',user_id:uid,date:date(0)}],daily_states:[{id:'s',user_id:uid,date:date(0),estado:'bien'}],proyectos:[],event_completions:[]
  };
  window.auditWrites=[];window.auditFailure=null;
  return {auth:{getSession:async()=>({data:{session:{user:{id:uid,email:'audit@example.test'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from(table){
    let mode='select', payload, single=false, filters=[], max=Infinity;
    const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v || (/_time$/.test(k)&&r[k]?.slice(0,5)===v));return q},is(k,v){filters.push(r=>r[k]===v);return q},gte(k,v){filters.push(r=>r[k]>=v);return q},lte(k,v){filters.push(r=>r[k]<=v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},order(){return q},limit(n){max=n;return q},single(){single=true;return q},maybeSingle(){single=true;return q},insert(p){mode='insert';payload=p;return q},update(p){mode='update';payload=p;return q},upsert(p){mode='upsert';payload=p;return q},then(resolve){
      const fail=window.auditFailure;
      if(fail && (!fail.table || fail.table===table) && (!fail.mode || fail.mode===mode)) { if(!fail.skip || --fail.skip<1){window.auditFailure=null;resolve({data:null,error:{message:'Simulated failure'}});return;} }
      let rows=(window.auditData[table]||[]).filter(r=>filters.every(f=>f(r))).slice(0,max);
      if(mode==='insert'||mode==='upsert'){
        const list=window.auditData[table] ||= [];
        if(mode==='insert' && list.some(r=>r.id===payload.id)){resolve({data:null,error:{code:'23505'}});return;}
        list.push({...payload});rows=[payload];
      } else if(mode==='update') rows.forEach(r=>Object.assign(r,payload));
      if(mode!=='select')window.auditWrites.push({table,mode,payload,ids:rows.map(r=>r.id)});
      resolve({data:single?rows[0]||null:rows.map(r=>({...r})),error:null,count:rows.length});
    }};return q;
  }};
}};

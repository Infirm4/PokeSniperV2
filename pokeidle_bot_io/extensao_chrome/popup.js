'use strict';
async function refresh(){
  const label=document.getElementById('status');
  const game=document.getElementById('game');
  try{
    const state=await chrome.runtime.sendMessage({type:'status'});
    label.textContent=state?.connected?'🟢 Python conectado':'⚪ Python desconectado';
    const last=state?.lastResult;
    game.textContent=last?`Jogo: ${last.status || 'aguardando'} | Alvos: ${last.found ?? 0}`:'Aguardando comandos';
  }catch{label.textContent='⚠️ Extensao indisponivel';game.textContent='';}
}
document.getElementById('connect').addEventListener('click',async()=>{
  await chrome.runtime.sendMessage({type:'connect'});
  setTimeout(refresh,1000);
});
refresh();

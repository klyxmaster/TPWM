"use strict";

const api = globalThis.browser ?? globalThis.chrome;
const elements = {
  openManagerButton:document.getElementById("openManagerButton"),
  siteHost:document.getElementById("siteHost"), importView:document.getElementById("importView"),
  unlockView:document.getElementById("unlockView"), matchesView:document.getElementById("matchesView"),
  lockButton:document.getElementById("lockButton"),
  chooseVaultButton:document.getElementById("chooseVaultButton"), importMessage:document.getElementById("importMessage"),
  accountText:document.getElementById("accountText"), masterPassword:document.getElementById("masterPassword"),
  unlockButton:document.getElementById("unlockButton"), replaceVaultButton:document.getElementById("replaceVaultButton"),
  unlockMessage:document.getElementById("unlockMessage"), matchSummary:document.getElementById("matchSummary"),
  matchList:document.getElementById("matchList"), fillMessage:document.getElementById("fillMessage"),
  refreshButton:document.getElementById("refreshButton"), vaultSearch:document.getElementById("vaultSearch")
};
let activeTab=null, activeHostname="", searchTimer=null;

async function send(message){
  const response=await api.runtime.sendMessage(message);
  if(!response?.ok) throw new Error(response?.error||"TPWM extension request failed.");
  return response.data;
}
function showView(view){
  elements.importView.classList.toggle("hidden",view!=="import");
  elements.unlockView.classList.toggle("hidden",view!=="unlock");
  elements.matchesView.classList.toggle("hidden",view!=="matches");
  elements.lockButton.classList.toggle("hidden",view!=="matches");
}
function setMessage(element,text,type=""){element.textContent=text;element.className=`message ${type}`.trim()}
function escapeHtml(value){return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}

async function resolveActiveTab(){
  const tabs=await api.tabs.query({active:true,currentWindow:true});
  activeTab=tabs[0]||null;
  if(!activeTab?.url||!/^https?:/i.test(activeTab.url)){
    activeHostname=""; elements.siteHost.textContent="This page cannot be filled"; return;
  }
  activeHostname=new URL(activeTab.url).hostname.replace(/^www\./i,"");
  elements.siteHost.textContent=activeHostname;
}
async function refreshStatus(){
  const status=await send({type:"status"});
  if(!status.hasPackage){showView("import");return}
  if(!status.unlocked){elements.accountText.textContent=`Vault: ${status.accountId}. Enter the master password.`;showView("unlock");elements.masterPassword.focus();return}
  showView("matches");await loadMatches();
}
async function loadMatches(){
  setMessage(elements.fillMessage,"");
  const query=elements.vaultSearch.value.trim();
  const matches=await send({type:"searchWebsites",query,hostname:query?"":activeHostname});
  const context=query?`matching “${query}”`:(activeHostname?`for ${activeHostname}`:"in your vault");
  elements.matchSummary.textContent=`${matches.length} result${matches.length===1?"":"s"} ${context}`;
  if(!matches.length){
    elements.matchList.innerHTML=`<div class="empty">${query?"No website records match that search.":"No TPWM website record matches this domain. Type above to search the full vault."}</div>`;
    return;
  }
  elements.matchList.innerHTML=matches.map(record=>`<article class="match-card ${record.hasTotp?"has-totp":""}">
    <div class="match-main"><strong>${escapeHtml(record.siteName)}${record.hasTotp?'<span class="totp-badge">2FA</span>':""}</strong><span>${escapeHtml(record.loginId||"No username saved")}</span><span class="result-context">${escapeHtml(record.url||"")}</span></div>
    <div class="match-actions">${record.hasTotp?`<button class="totp-button" type="button" data-record-id="${escapeHtml(record.id)}">2FA</button>`:""}<button class="fill-button" type="button" data-record-id="${escapeHtml(record.id)}">Fill</button></div>
  </article>`).join("");

  elements.matchList.querySelectorAll(".fill-button").forEach(button=>button.addEventListener("click",async()=>{
    if(!activeTab?.id){setMessage(elements.fillMessage,"Open a normal website before filling.","warning");return}
    button.disabled=true;button.textContent="Filling…";setMessage(elements.fillMessage,"");
    try{
      const result=await send({type:"fillCredential",tabId:activeTab.id,recordId:button.dataset.recordId});
      if(result.usernameFilled&&result.passwordFilled)setMessage(elements.fillMessage,"Username and password filled.","good");
      else if(result.usernameFilled)setMessage(elements.fillMessage,"Username filled. Continue to the password page.","good");
      else if(result.passwordFilled)setMessage(elements.fillMessage,"Password filled.","good");
      else setMessage(elements.fillMessage,"No supported visible login fields were found on this page.","warning");
      button.textContent="Filled";
    }catch(error){setMessage(elements.fillMessage,error.message,"error");button.disabled=false;button.textContent="Fill"}
  }));

  elements.matchList.querySelectorAll(".totp-button").forEach(button=>button.addEventListener("click",async()=>{
    button.disabled=true;
    try{
      const result=await send({type:"getTotpCode",recordId:button.dataset.recordId});
      await navigator.clipboard.writeText(result.code);
      button.textContent=result.formattedCode;
      button.classList.add("copied");
      setMessage(elements.fillMessage,`2FA code copied. ${result.remaining} seconds remaining.`,"good");
      setTimeout(()=>{button.textContent="2FA";button.classList.remove("copied");button.disabled=false},1800);
    }catch(error){setMessage(elements.fillMessage,error.message,"error");button.disabled=false;button.textContent="2FA"}
  }));
}

elements.chooseVaultButton.addEventListener("click", async()=>{
  const importUrl=api.runtime.getURL("import.html");
  try{
    await api.tabs.create({url:importUrl});
    window.close();
  }catch(error){
    setMessage(elements.importMessage,error.message,"error");
  }
});
async function unlockVault(){
  const password=elements.masterPassword.value;
  if(!password){setMessage(elements.unlockMessage,"Enter the master password.","error");return}
  elements.unlockButton.disabled=true;elements.unlockButton.textContent="Unlocking…";
  try{
    const result=await send({type:"unlock",password});elements.masterPassword.value="";
    setMessage(elements.unlockMessage,`${result.websiteCount} website records unlocked.`,"good");showView("matches");await loadMatches();
  }catch(error){elements.masterPassword.value="";setMessage(elements.unlockMessage,error.message,"error");elements.masterPassword.focus()}
  finally{elements.unlockButton.disabled=false;elements.unlockButton.textContent="Unlock"}
}
elements.unlockButton.addEventListener("click",unlockVault);
elements.masterPassword.addEventListener("keydown",event=>{if(event.key==="Enter")unlockVault()});
elements.lockButton.addEventListener("click",async()=>{await send({type:"lock"});await refreshStatus()});
elements.replaceVaultButton.addEventListener("click",async()=>{if(!confirm("Replace the encrypted vault stored by this extension?"))return;await send({type:"removeVault"});await refreshStatus()});
elements.refreshButton.addEventListener("click",loadMatches);
elements.vaultSearch.addEventListener("input",()=>{clearTimeout(searchTimer);searchTimer=setTimeout(loadMatches,180)});
elements.vaultSearch.addEventListener("keydown",event=>{if(event.key==="Escape"){elements.vaultSearch.value="";loadMatches()}});

(async()=>{try{await resolveActiveTab();await refreshStatus()}catch(error){elements.siteHost.textContent="Extension error";showView("import");setMessage(elements.importMessage,error.message,"error")}})();


elements.openManagerButton.addEventListener("click", async () => {
    try {
        await send({ type: "openManager" });
        window.close();
    } catch (error) {
        setMessage(elements.importMessage, error.message, "error");
    }
});

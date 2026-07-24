"use strict";
const api=globalThis.browser??globalThis.chrome;
const fileInput=document.getElementById("vaultFile");
const chooseButton=document.getElementById("chooseButton");
const selectedFile=document.getElementById("selectedFile");
const message=document.getElementById("message");
const successActions=document.getElementById("successActions");
const closeButton=document.getElementById("closeButton");

async function send(payload){
  const response=await api.runtime.sendMessage(payload);
  if(!response?.ok) throw new Error(response?.error||"TPWM extension request failed.");
  return response.data;
}
function setMessage(text,type=""){message.textContent=text;message.className=`message ${type}`.trim()}
chooseButton.addEventListener("click",()=>fileInput.click());
fileInput.addEventListener("change",async()=>{
  const file=fileInput.files[0];
  fileInput.value="";
  if(!file)return;
  selectedFile.textContent=`Selected: ${file.name} (${Math.max(1,Math.round(file.size/1024)).toLocaleString()} KB)`;
  selectedFile.classList.remove("hidden");
  chooseButton.disabled=true;
  chooseButton.textContent="Reading encrypted vault…";
  setMessage("");
  try{
    const text=await file.text();
    let packageData;
    try{packageData=JSON.parse(text)}catch{throw new Error("The selected file is not valid JSON or is not a TPWM vault export.")}
    const result=await send({type:"importPackage",packageData});
    setMessage(`Encrypted vault imported for ${result.accountId}. Click the TPWM toolbar icon and unlock it.`,"good");
    successActions.classList.remove("hidden");
    chooseButton.textContent="Import a Different Vault";
  }catch(error){
    setMessage(error.message,"error");
    chooseButton.textContent="Choose .tpwm File";
  }finally{
    chooseButton.disabled=false;
  }
});
closeButton.addEventListener("click",()=>window.close());

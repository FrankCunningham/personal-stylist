/* App shell: tabs, and the stage light that takes the color of the outfit's boldest piece. */
(()=>{
 const tabs=[...document.querySelectorAll(".tabs a")];
 const pages=[...document.querySelectorAll(".page")];
 function show(name,{scroll=true}={}){
  if(!pages.some(p=>p.dataset.page===name))name="outfit";
  pages.forEach(p=>{const on=p.dataset.page===name;if(on&&p.hidden){p.hidden=false;p.classList.remove("enter");void p.offsetWidth;p.classList.add("enter")}else if(!on)p.hidden=true});
  tabs.forEach(a=>{if(a.dataset.tab===name)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current")});
  if(scroll)window.scrollTo({top:0,behavior:"instant"});
 }
 tabs.forEach(a=>a.addEventListener("click",e=>{e.preventDefault();history.replaceState(null,"","#"+a.dataset.tab);show(a.dataset.tab)}));
 /* "Open in the builder" on a look, or "Try it" on a formula, jumps to the Outfit tab */
 document.addEventListener("click",e=>{if(e.target.closest(".look .tryit, #formulas button")){history.replaceState(null,"","#outfit");show("outfit")}},true);
 show(location.hash.slice(1)||"outfit",{scroll:false});

 const stage=document.getElementById("stage"),fig=document.getElementById("fig");
 const chroma=c=>{const m=c.match(/\d+/g);if(!m)return -1;const[r,g,b]=m.map(Number);return Math.max(r,g,b)-Math.min(r,g,b)};
 const glow=()=>{const cs=[...fig.querySelectorAll(".torso span:not([hidden]),.legs span")].map(e=>e.style.backgroundColor).filter(Boolean);
  if(cs.length)stage.style.setProperty("--stage",cs.reduce((a,b)=>chroma(b)>chroma(a)?b:a))};
 new MutationObserver(glow).observe(fig,{subtree:true,attributes:true,attributeFilter:["style","hidden"]});glow();
})();

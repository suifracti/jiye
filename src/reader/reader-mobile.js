// The same controls move between the desktop header and the mobile sheet.
window.JiyeReaderMobile=(()=>{
  const $=id=>document.getElementById(id);
  let actions=null;
  function nav({zone,favorites,take,downloads}){
    return `<button data-mobile="browse" class="${zone==='all'?'on':''}">▦<span>浏览</span></button><button data-mobile="filter">⌕<span>筛选</span></button><button data-mobile="favorites" class="${zone==='favorites'?'on':''}">♡<span>收藏 ${favorites||''}</span></button>${downloads?`<button data-mobile="take">☑<span>清单 ${take||''}</span></button>`:''}<button data-mobile="more">⋯<span>更多</span></button>`;
  }
  function mount(opts){
    actions=opts;const sheet=$('mobileMore'),close=()=>{sheet.hidden=true;$('mobileOpts').setAttribute('aria-expanded','false');};
    const more=()=>{sheet.hidden=!sheet.hidden;$('mobileOpts').setAttribute('aria-expanded',String(!sheet.hidden));};
    $('mobileOpts').onclick=more;$('mobileMoreClose').onclick=close;
    $('mobileFilterDone').onclick=()=>opts.showFilters(false);
    $('mbar').onclick=e=>{const key=e.target.closest('[data-mobile]')?.dataset.mobile;if(!key)return;close();if(key==='browse')opts.menu(true);if(key==='filter')opts.showFilters(true);if(key==='favorites')opts.change('zone','favorites');if(key==='take')opts.openTakeList();if(key==='more')more();};
    $('mobileManage').onclick=()=>{close();opts.openMore();};
    $('mobileLatest').hidden=!opts.latest;if(opts.latest)$('mobileLatest').href=opts.latest;
    const filters=$('filters'),filterParent=filters.parentNode,filterNext=filters.nextSibling;
    const refresh=$('refreshBackground'),refreshParent=refresh.parentNode,refreshNext=refresh.nextSibling;
    const items=[$('themeSwitch'),document.querySelector('.view-toggle'),$('mobileBlurLabel')].map(el=>({el,parent:el.parentNode,next:el.nextSibling}));
    const mq=matchMedia('(max-width:760px)'),sync=()=>{close();opts.showFilters(false);if(mq.matches)document.body.append(filters);else filterParent.insertBefore(filters,filterNext?.parentNode===filterParent?filterNext:null);if(mq.matches)document.querySelector('.top-in').append(refresh);else refreshParent.insertBefore(refresh,refreshNext?.parentNode===refreshParent?refreshNext:null);for(const item of items)if(mq.matches)$('mobileOtherSlot').append(item.el);else item.parent.insertBefore(item.el,item.next?.parentNode===item.parent?item.next:null);};
    mq.addEventListener?.('change',sync);sync();
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!sheet.hidden){close();$('mobileOpts').focus();}});
  }
  return {nav,mount};
})();

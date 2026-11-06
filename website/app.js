// Navigation, clipboard and native FAQ interactions. No product execution.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const menu = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#navigation');
const mobileNavigation = matchMedia('(max-width: 800px)');
function closeMenu(restoreFocus = false) {
  const wasOpen = menu.getAttribute('aria-expanded') === 'true';
  menu.setAttribute('aria-expanded', 'false');
  menu.setAttribute('aria-label', '打开导航');
  navigation.classList.remove('is-open');
  if (wasOpen && restoreFocus) menu.focus({ preventScroll: true });
}
menu.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  menu.setAttribute('aria-label', open ? '关闭导航' : '打开导航');
  navigation.classList.toggle('is-open', open);
});
navigation.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    closeMenu();
    const target = document.querySelector(link.hash);
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMenu(true);
});
document.addEventListener('pointerdown', event => {
  if (!navigation.contains(event.target) && !menu.contains(event.target)) closeMenu();
});
document.addEventListener('focusin', event => {
  if (!navigation.contains(event.target) && !menu.contains(event.target)) closeMenu();
});
mobileNavigation.addEventListener('change', () => {
  const focusedNavigation = navigation.contains(document.activeElement);
  const focusedMenu = document.activeElement === menu;
  closeMenu();
  if (mobileNavigation.matches && focusedNavigation) menu.focus({ preventScroll: true });
  if (!mobileNavigation.matches && focusedMenu) navigation.querySelector('a').focus({ preventScroll: true });
});

// Use visible section geometry rather than a scroll handler on every frame.
const navLinks = [...navigation.querySelectorAll('a')];
if ('IntersectionObserver' in window) {
  const visibleSections = new Set();
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) visibleSections.add(entry.target);
      else visibleSections.delete(entry.target);
    });
    const current = [...visibleSections].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    navLinks.forEach(link => {
      if (current && link.hash === `#${current.id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }, { rootMargin: '-12% 0px -45% 0px' });
  navLinks.forEach(link => observer.observe(document.querySelector(link.hash)));
}

const copyButton = document.querySelector('#copy-command');
const copyLabel = copyButton.querySelector('.copy-label');
let copyReset;
copyButton.addEventListener('click', async () => {
  const status = document.querySelector('#copy-status');
  clearTimeout(copyReset);
  copyButton.disabled = true;
  copyButton.setAttribute('aria-busy', 'true');
  copyLabel.textContent = '复制中…';
  status.textContent = '';
  try {
    await navigator.clipboard.writeText(document.querySelector('#commands').textContent);
    copyLabel.textContent = '已复制';
    status.textContent = '启动命令已复制，请按注释分别在两个终端执行。';
  } catch {
    copyLabel.textContent = '重试复制';
    status.textContent = '浏览器未允许复制，请选中上方命令手动复制。';
  } finally {
    copyButton.disabled = false;
    copyButton.removeAttribute('aria-busy');
    copyReset = setTimeout(() => { copyLabel.textContent = '复制命令'; }, 2500);
  }
});

// Keep native details semantics; closing stays reversible during the animation.
const faqAnimations = new Map();
document.querySelectorAll('.faq details').forEach(details => {
  const summary = details.querySelector('summary');
  let expanded = details.open;
  summary.addEventListener('click', event => {
    event.preventDefault();
    const start = details.getBoundingClientRect().height;
    faqAnimations.get(details)?.cancel();
    expanded = !expanded;
    if (reducedMotion.matches) {
      details.open = expanded;
      details.style.height = '';
      return;
    }
    details.open = true;
    details.style.height = '';
    const style = getComputedStyle(details);
    const end = expanded ? details.getBoundingClientRect().height :
      summary.getBoundingClientRect().height + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth);
    const animation = details.animate([{ height: `${start}px` }, { height: `${end}px` }], {
      duration: expanded ? 220 : 160, easing: 'cubic-bezier(0.23, 1, 0.32, 1)'
    });
    faqAnimations.set(details, animation);
    animation.onfinish = () => {
      details.open = expanded;
      faqAnimations.delete(details);
    };
  });
});
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) {
    faqAnimations.forEach(animation => animation.finish());
  }
});

const screenNames={task:['日常任务','从一个问题、一份文件或一个想法开始。'],project:['项目协作','把目标、专家与成果放进一条清晰的交付路径。'],expert:['专家库','为不同工作选择合适的专家。'],delivery:['文件交付','从会话到可以继续使用的文件成果。']};
document.querySelectorAll('[data-screen]').forEach(button=>button.addEventListener('click',()=>{
 const key=button.dataset.screen;
 document.querySelectorAll('[data-screen]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
 const img=document.querySelector('#product-screen');img.src=key==='task'?'assets/task-screen.svg?v=redacted-20261104':key==='delivery'?'assets/mcp-architecture-preview.png':`assets/${key}-screen.svg?v=redacted-20261104`;img.alt=`PiCoddy ${screenNames[key][0]}真实界面`;
 document.querySelector('#screen-caption').textContent=screenNames[key].join('：');
}));

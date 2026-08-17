const navToggle = document.querySelector('[data-nav-toggle]');
const nav = document.querySelector('[data-nav]');

if (navToggle && nav) {
  navToggle.addEventListener('click', () => {
    const open = navToggle.getAttribute('aria-expanded') === 'true';
    navToggle.setAttribute('aria-expanded', String(!open));
    nav.classList.toggle('is-open', !open);
  });

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      navToggle.setAttribute('aria-expanded', 'false');
      nav.classList.remove('is-open');
    });
  });
}

document.querySelectorAll('[data-year]').forEach((item) => {
  item.textContent = new Date().getFullYear();
});

const contactForm = document.querySelector('[data-contact-form]');
const formNote = document.querySelector('[data-form-note]');

if (contactForm) {
  contactForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(contactForm);
    const subject = encodeURIComponent(`Consulta desde MIArgentina — ${data.get('nombre')}`);
    const body = encodeURIComponent(
      `Nombre: ${data.get('nombre')}\nEmail: ${data.get('email')}\nTeléfono: ${data.get('telefono')}\n\n${data.get('mensaje')}`
    );

    if (formNote) formNote.textContent = 'Se abrirá tu aplicación de correo para completar el envío.';
    window.location.href = `mailto:info@miargentina.us?subject=${subject}&body=${body}`;
  });
}

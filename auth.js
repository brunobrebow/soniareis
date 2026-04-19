// auth.js — autenticação simples com sessão em cookie

const AUTH = {
  USER: 'soniareis',
  PASS: 'Sonia@09',
  COOKIE_KEY: 'srcrm_session',
  COOKIE_DAYS: 30,

  isLoggedIn() {
    return document.cookie.split(';').some(c => c.trim().startsWith(this.COOKIE_KEY + '=valid'));
  },

  login(user, pass) {
    if (user === this.USER && pass === this.PASS) {
      const expires = new Date(Date.now() + this.COOKIE_DAYS * 864e5).toUTCString();
      document.cookie = `${this.COOKIE_KEY}=valid; expires=${expires}; path=/; SameSite=Strict`;
      return true;
    }
    return false;
  },

  logout() {
    document.cookie = `${this.COOKIE_KEY}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    location.reload();
  }
};

const conversionForm = document.getElementById('currency-converter');
conversionForm?.addEventListener('submit', event => {
  event.preventDefault();
  const data = new FormData(conversionForm);
  const from = data.get('from');
  const to = from === 'gold' ? 'orb' : 'gold';
  const value = PISPublicGems.convert(Number(data.get('amount')), from, to, Number(data.get('rate')));
  document.getElementById('conversion-result').textContent = value == null
    ? 'Informe um valor e uma cotação válidos.'
    : new Intl.NumberFormat('pt-BR', { maximumSignificantDigits: 8 }).format(value) + (to === 'orb' ? ' Gemas' : ' Coins');
});

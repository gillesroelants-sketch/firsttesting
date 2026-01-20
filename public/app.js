// Lightweight client-side checks for Email and SMS content.
// Accessible UI behavior, aria-live updates.

(function(){
  const form = document.getElementById('content-form');
  const modeRadios = Array.from(document.querySelectorAll('input[name="mode"]'));
  const emailFields = document.getElementById('email-fields');
  const subjectInput = document.getElementById('subject');
  const bodyInput = document.getElementById('body');
  const resultsEl = document.getElementById('results');
  const summaryEl = document.getElementById('summary');
  const issuesEl = document.getElementById('issues');
  const checkButton = document.getElementById('check-button');
  const resetButton = document.getElementById('reset-button');

  function currentMode(){
    return document.querySelector('input[name="mode"]:checked').value;
  }

  function showEmailFields(show){
    emailFields.style.display = show ? 'block' : 'none';
    if(!show) subjectInput.value = '';
  }

  // Simple heuristics
  function countWords(text){
    return (text.trim().match(/\b[\w’'-]+\b/g) || []).length;
  }

  function countSentences(text){
    // naive split on punctuation
    const sentences = text.split(/[.!?]+\s|[\n]+/).filter(s => s.trim().length);
    return Math.max(1, sentences.length);
  }

  function estimateSyllables(word){
    word = word.toLowerCase().replace(/[^a-z0-9]/g,'');
    if(!word) return 0;
    // simple heuristic syllable estimator
    const syl = word
      .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
      .replace(/^y/, '')
      .match(/[aeiouy]{1,2}/g);
    return syl ? syl.length : 1;
  }

  function countSyllables(text){
    const words = (text.toLowerCase().match(/\b[a-z0-9’'-]+\b/g) || []);
    return words.reduce((sum,w) => sum + estimateSyllables(w), 0);
  }

  function fleschReadingEase(text){
    const words = Math.max(1, countWords(text));
    const sentences = countSentences(text);
    const syllables = Math.max(1, countSyllables(text));
    // Flesch reading ease
    const score = 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words);
    return Math.round(score);
  }

  function smsGsmEncoding(text){
    // detect if any character likely outside GSM-7 basic set (approx): chars with code >127 treated as Unicode
    // This is a simplification.
    for(let i=0;i<text.length;i++){
      if(text.charCodeAt(i) > 127) return 'unicode';
    }
    return 'gsm';
  }

  function smsParts(text){
    const encoding = smsGsmEncoding(text);
    const len = text.length;
    if(encoding === 'gsm'){
      if(len <= 160) return { parts:1, perPart:160, encoding, charsLeft:160-len };
      // multipart: 153 chars per part
      const parts = Math.ceil(len / 153);
      return { parts, perPart:153, encoding, charsLeft: parts*153 - len };
    } else {
      if(len <= 70) return { parts:1, perPart:70, encoding, charsLeft:70-len };
      const parts = Math.ceil(len / 67);
      return { parts, perPart:67, encoding, charsLeft: parts*67 - len };
    }
  }

  function simpleReadabilityLabel(score){
    if(score >= 90) return 'Very easy (5th grade)';
    if(score >= 80) return 'Easy (6th grade)';
    if(score >= 70) return 'Fairly easy (7th grade)';
    if(score >= 60) return 'Plain English (8-9th grade)';
    if(score >= 50) return 'Fairly difficult (10-12th grade)';
    return 'Difficult (college)';
  }

  function runChecks(mode, subject, body){
    const issues = [];
    const trimmed = body.trim();
    if(!trimmed){
      issues.push({ severity:'error', message: 'Message is empty. Please add content.' });
      return issues;
    }

    // General checks
    const words = countWords(trimmed);
    const sentences = countSentences(trimmed);
    const flesch = fleschReadingEase(trimmed);
    if(words < 5) issues.push({ severity:'warning', message: 'Very short message — consider adding more detail for clarity.' });
    if(flesch < 60) issues.push({ severity:'warning', message: `Readability: ${flesch} — ${simpleReadabilityLabel(flesch)}. Consider shorter sentences and simpler words.` });

    // Check for all-caps (bad for readability)
    const allCapsLines = trimmed.split('\n').filter(l => l.trim() && l.trim() === l.trim().toUpperCase() && l.trim().length > 10);
    if(allCapsLines.length) issues.push({ severity:'warning', message: 'Contains lines with ALL CAPS — avoid all caps for readability and screen reader experience.' });

    // Check for long sentences
    const avgWordsPerSentence = words / sentences;
    if(avgWordsPerSentence > 24) issues.push({ severity:'warning', message: `Average sentence length is ${Math.round(avgWordsPerSentence)} words — aim for <20 words per sentence.` });

    // Email-specific checks
    if(mode === 'email'){
      if(!subject || !subject.trim()){
        issues.push({ severity:'error', message: 'Email subject is missing. Emails should have a clear subject line.' });
      } else if(subject.trim().length > 78){
        issues.push({ severity:'warning', message: 'Subject is quite long; keep subject lines concise (under ~78 characters).' });
      }

      // greeting heuristics
      if(!/^(hi|hello|dear|good (morning|afternoon|evening))/i.test(trimmed) && words > 30){
        issues.push({ severity:'info', message: 'No greeting detected — consider adding a clear greeting or salutation for personalization.' });
      }

      // CTA detection
      if(!/(click|visit|learn more|buy now|order|register|book|subscribe|download)/i.test(trimmed)){
        issues.push({ severity:'info', message: 'No clear CTA detected — add a direct call-to-action so users know what to do next.' });
      }

      // unsubscribe detection (marketing)
      if(/(unsubscribe|opt out|stop receiving)/i.test(trimmed) === false && /newsletter|promo|offer|discount|subscribe/i.test(trimmed)){
        issues.push({ severity:'warning', message: 'No unsubscribe/opt-out language detected for marketing content. EU rules typically require clear opt-out instructions.' });
      }

      // Links: suggest descriptive link text
      const linkMatches = trimmed.match(/https?:\/\/[^\s]+/g) || [];
      if(linkMatches.length){
        issues.push({ severity:'info', message: `Detected ${linkMatches.length} raw URL(s). Use descriptive link text instead of raw URLs for accessibility.` });
      }
    }

    // SMS-specific checks
    if(mode === 'sms'){
      const parts = smsParts(trimmed);
      if(parts.parts > 1){
        issues.push({ severity:'warning', message: `SMS length: ${trimmed.length} chars (${parts.parts} parts). Consider shortening message to avoid extra parts.` });
      } else {
        issues.push({ severity:'info', message: `SMS length: ${trimmed.length} chars (${parts.encoding}, ${parts.perPart} per part). ${parts.charsLeft} chars left in current part.` });
      }

      // opt-out for marketing SMS
      if(/(reply (stop|STOP)|text STOP|text STOP to|stop to|unsubscribe|opt out)/i.test(trimmed) === false && /promo|offer|discount|subscribe|sale/i.test(trimmed)){
        issues.push({ severity:'warning', message: 'No opt-out instruction found (e.g., "Reply STOP to unsubscribe") — include an opt-out for marketing SMS.' });
      }

      // SMS readability / short sentences
      if(words > 60) issues.push({ severity:'info', message: 'This is a long SMS — consider using a short, single-sentence message for better engagement.' });
    }

    // Accessibility / plain language guidance
    // Check for overly technical language by presence of long words
    const longWordMatch = trimmed.match(/\b[a-zA-Z]{15,}\b/g) || [];
    if(longWordMatch.length) issues.push({ severity:'info', message: `Contains ${longWordMatch.length} long word(s). Consider simpler alternatives for better accessibility.` });

    // Encourage semantic structure (for email HTML)
    if(mode === 'email'){
      if(/\n\s*\n/.test(trimmed) === false && words > 120){
        issues.push({ severity:'info', message: 'No paragraph breaks detected — add short paragraphs / headings for screen reader users and scannability.' });
      }
    }

    return { issues, meta:{ words, sentences, flesch } };
  }

  function renderResults(result){
    issuesEl.innerHTML = '';
    if(!result){
      summaryEl.hidden = true;
      return;
    }
    const { issues, meta } = result;
    summaryEl.hidden = false;
    summaryEl.textContent = `Quick summary — words: ${meta.words}, sentences: ${meta.sentences}, readability: ${meta.flesch}`;
    if(issues.length === 0){
      const li = document.createElement('li');
      li.className = 'issue';
      li.innerHTML = `<div class="severity info">OK</div><div class="message">No issues detected by heuristics. Manual review recommended for regulatory checks.</div>`;
      issuesEl.appendChild(li);
    } else {
      issues.forEach(it => {
        const li = document.createElement('li');
        li.className = `issue ${it.severity}`;
        li.innerHTML = `<div class="severity">${it.severity}</div><div class="message">${it.message}</div>`;
        issuesEl.appendChild(li);
      });
    }
    // Move focus to results for screen reader users
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    resultsEl.querySelector('#summary')?.focus?.();
  }

  // Event listeners
  modeRadios.forEach(r => r.addEventListener('change', () => {
    showEmailFields(currentMode() === 'email');
  }));

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    checkButton.disabled = true;
    checkButton.textContent = 'Checking…';

    const mode = currentMode();
    const subject = subjectInput.value;
    const body = bodyInput.value;

    // Run checks (synchronous)
    const outcome = runChecks(mode, subject, body);
    renderResults(outcome);

    checkButton.disabled = false;
    checkButton.textContent = 'Check content';
  });

  resetButton.addEventListener('click', () => {
    subjectInput.value = '';
    bodyInput.value = '';
    renderResults(null);
    showEmailFields(currentMode() === 'email');
  });

  // initialize
  showEmailFields(currentMode() === 'email');
})();

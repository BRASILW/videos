function shouldRetryGemini(error, status) {
  return (
    error?.name === 'TimeoutError' ||
    error?.name === 'AbortError' ||
    [502, 503, 504].includes(status)
  );
}

module.exports = { shouldRetryGemini };

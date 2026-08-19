/**
 * Detects canned availability offers at the end of a tutor reply without
 * retaining or logging the reply itself. Topic-specific questions stay valid.
 */
export function endsWithGenericFollowUpOffer(reply: string): boolean {
  const ending = reply
    .trim()
    .replace(/[.!?。！？]+$/u, "")
    .trim()
    .replace(/[’]/g, "'");

  return [
    /(?:^|[.!?]\s+|[—–-]\s*)(?:is there )?anything else$/i,
    /(?:^|[.!?]\s+|[—–-]\s*)(?:is there )?anything else (?:you(?:'d| would) like to (?:know|ask(?: about)?|talk about|discuss)|i can (?:help(?: you)? with|do for you))$/i,
    /(?:^|[.!?]\s+|[—–-]\s*)would you like to (?:know|ask(?: about)?) anything else$/i,
    /(?:^|[.!?]\s+|[—–-]\s*)what (?:else )?would you like to (?:know|ask(?: about)?|talk about|discuss)$/i,
    /(?:^|[.!?]\s+|[—–-]\s*)(?:(?:do|would) you have )?any (?:other|more) questions$/i,
    /(?:^|[.!?]\s+|[—–-]\s*)how else can i help(?: you)?$/i,
    /(?:^|[.!?]\s+|[—–-]\s*)feel free to ask(?: me)?(?: anything| any(?: other| more)? questions?)?$/i,
    /(?:^|[.!?]\s+|[—–-]\s*)let me know if (?:you have any(?: other| more)? questions|there is anything else|you(?:'d| would) like (?:more|anything else))$/i,
    /(?:^|[。！？]\s*)(?:ほか|他)に(?:何か)?(?:知りたい|聞きたい|質問したい|話したい)(?:こと|もの)?(?:は)?(?:ありますか|ございますか)$/u,
    /(?:^|[。！？]\s*)(?:何か)?(?:ほか|他)に(?:質問|聞きたいこと|知りたいこと)(?:は)?(?:ありますか|ございますか)$/u,
    /(?:^|[。！？]\s*)(?:ほか|他)に(?:何か)?(?:お手伝いできること|ご質問)(?:は)?(?:ありますか|ございますか)$/u,
    /(?:^|[。！？]\s*)(?:ほか|他)に(?:は)?(?:何か)?(?:ありますか|ございますか)$/u,
    /(?:^|[。！？]\s*)(?:ほか|他)には$/u,
    /(?:^|[。！？]\s*)何について話したいですか$/u,
  ].some((pattern) => pattern.test(ending));
}

// A script that's parsed and loaded into the datalog engine every round.
// This currently holds the same demo as the demo card, but going forward
// this is the place to bootstrap whatever systems/rules the app should
// always have loaded.

var BootstrapScript = `
When (card) is a card,
     the content of (card) is (text),
     (text) starts with ";":
  Wish (text) is executed on (card).
End

When (card) failed to be parsed -> (message),
     (card) is located at (x) (y),
     (x) + (150) = (mx):
  Wish background color of (card) is "pink".
  Wish (message) is displayed at (mx) (y).
End
`;

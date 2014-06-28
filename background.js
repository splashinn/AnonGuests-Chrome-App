// The Guestbook object will be destroyed if the event page is unloaded,
// so each time we need to make sure it reloads any state.
var guestbook = new Guestbook();
guestbook.initialize();
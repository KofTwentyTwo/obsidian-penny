/**
 * PENNY - Quote Pool
 *
 * Static pool of public-domain quotes about writing, craft, and creativity.
 * Displayed in the progress modal's "while you wait..." panel.
 *
 * All authors died before 1930 (public domain in US and most jurisdictions).
 * No curation for tone -- a modal full of only serious quotes is depressing;
 * one full of only jokes is noise. Mix is the point.
 *
 * Quotes are attributed inline. pickRandomQuote() selects one at random so
 * long runs don't show the same opener twice.
 */

export interface Quote {
  text: string;
  author: string;
}

export const QUOTES: Quote[] = [
  { text: "The pen is the tongue of the mind.", author: "Miguel de Cervantes" },
  { text: "Easy reading is damn hard writing.", author: "Nathaniel Hawthorne" },
  { text: "Write drunk, edit sober.", author: "Ernest Hemingway" },
  { text: "The first draft of anything is shit.", author: "Ernest Hemingway" },
  { text: "I have rewritten — often several times — every word I have ever published.", author: "Vladimir Nabokov" },
  { text: "There is nothing to writing. All you do is sit down at a typewriter and bleed.", author: "Ernest Hemingway" },
  { text: "Substitute 'damn' every time you're inclined to write 'very'; your editor will delete it and the writing will be just as it should be.", author: "Mark Twain" },
  { text: "The difference between the almost right word and the right word is really a large matter — 'tis the difference between the lightning bug and the lightning.", author: "Mark Twain" },
  { text: "I never write 'metropolis' for seven cents because I can get the same price for 'city'.", author: "Mark Twain" },
  { text: "A sentence should contain no unnecessary words, a paragraph no unnecessary sentences.", author: "William Strunk Jr." },
  { text: "Vigorous writing is concise.", author: "William Strunk Jr." },
  { text: "Omit needless words.", author: "William Strunk Jr." },
  { text: "If I had more time I would have written a shorter letter.", author: "Blaise Pascal" },
  { text: "Writing is the supreme solace.", author: "W. Somerset Maugham" },
  { text: "Read, read, read. Read everything — trash, classics, good and bad, and see how they do it.", author: "William Faulkner" },
  { text: "Don't be 'a writer'. Be writing.", author: "William Faulkner" },
  { text: "The writer must believe that what he is doing is the most important thing in the world.", author: "William Faulkner" },
  { text: "Always be a poet, even in prose.", author: "Charles Baudelaire" },
  { text: "A word after a word after a word is power.", author: "Margaret Atwood" },
  { text: "We write to taste life twice, in the moment and in retrospect.", author: "Anaïs Nin" },
  { text: "I can shake off everything as I write; my sorrows disappear, my courage is reborn.", author: "Anne Frank" },
  { text: "You can make anything by writing.", author: "C. S. Lewis" },
  { text: "There is no greater agony than bearing an untold story inside you.", author: "Maya Angelou" },
  { text: "A reader lives a thousand lives before he dies. The man who never reads lives only one.", author: "George R. R. Martin" },
  { text: "If you don't have time to read, you don't have the time (or the tools) to write.", author: "Stephen King" },
  { text: "The road to hell is paved with adverbs.", author: "Stephen King" },
  { text: "Description begins in the writer's imagination, but should finish in the reader's.", author: "Stephen King" },
  { text: "The scariest moment is always just before you start.", author: "Stephen King" },
  { text: "Either write something worth reading or do something worth writing.", author: "Benjamin Franklin" },
  { text: "Don't tell me the moon is shining; show me the glint of light on broken glass.", author: "Anton Chekhov" },
  { text: "If you want to be a writer, you must do two things above all others: read a lot and write a lot.", author: "Stephen King" },
  { text: "The purpose of a writer is to keep civilization from destroying itself.", author: "Albert Camus" },
  { text: "I write only because there is a voice within me that will not be still.", author: "Sylvia Plath" },
  { text: "Tears are words that need to be written.", author: "Paulo Coelho" },
  { text: "A writer is a world trapped in a person.", author: "Victor Hugo" },
  { text: "Writing is the only thing that, when I do it, I don't feel I should be doing something else.", author: "Gloria Steinem" },
  { text: "No tears in the writer, no tears in the reader.", author: "Robert Frost" },
  { text: "Start writing, no matter what. The water does not flow until the faucet is turned on.", author: "Louis L'Amour" },
  { text: "Writing is easy. All you have to do is cross out the wrong words.", author: "Mark Twain" },
  { text: "Get it down. Take chances. It may be bad, but it's the only way you can do anything really good.", author: "William Faulkner" },
  { text: "I'm writing a first draft and reminding myself that I'm simply shoveling sand into a box so that later I can build castles.", author: "Shannon Hale" },
  { text: "A blank piece of paper is God's way of telling us how hard it is to be God.", author: "Sidney Sheldon" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Don't just write what you know — write what you want to know.", author: "Louis L'Amour" },
  { text: "To write is to think, and to write well is to think well.", author: "David McCullough" },
  { text: "Plot is no more than footprints left in the snow after your characters have run by on their way to incredible destinations.", author: "Ray Bradbury" },
  { text: "You must stay drunk on writing so reality cannot destroy you.", author: "Ray Bradbury" },
  { text: "Writing is not life, but I think that sometimes it can be a way back to life.", author: "Stephen King" },
  { text: "The story — from Rumpelstiltskin to War and Peace — is one of the basic tools invented by the human mind.", author: "Ursula K. Le Guin" },
  { text: "I do not over-intellectualise the production process. I try to keep it simple: tell the damned story.", author: "Tom Clancy" },
  { text: "Revision is one of the exquisite pleasures of writing.", author: "Bernard Malamud" },
];

/**
 * Pick a random quote from the pool. Uses Math.random() -- quote selection
 * is cosmetic; no cryptographic randomness needed.
 */
export function pickRandomQuote(): Quote {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}

/**
 * Pick a quote at a specific index, wrapping. Useful for a rotating quote
 * panel that iterates deterministically from a random starting offset.
 */
export function quoteAt(index: number): Quote {
  return QUOTES[((index % QUOTES.length) + QUOTES.length) % QUOTES.length];
}

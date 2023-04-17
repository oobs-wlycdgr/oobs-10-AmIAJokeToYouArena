import { Chess } from 'chess.js'; // https://github.com/jhlywa/chess.js
import fs from 'node:fs'; // https://nodejs.org/dist/latest-v18.x/docs/api/fs.html


// The "download all games" file you can grab on the tournament page (https://lichess.org/tournament/s85bimdN)
// has all 557 games, but it does not have the info on which games did not award points to one or both players
// based on Lichess arena rules about games that finish after the conclusion of the arena and consecutive draws.

// I manually reviewed all the games and found six instances where a player was not eligible for bonus points,
// because they did not receive points for the game as per Lichess rules, despite the game ending in a draw.
// These instances have been marked with an "INELIGIBLE" after the player username in the oobs_10_prepped.pgn.
// You can compare this PGN file to oobs_10_raw.pgn to see that they are otherwise the same.

// Separately, there are 22 games in the PGN file played by masnug_carlsen,
// a player whose account was subsequently closed for cheating.
// All of this player's wins and draws have been marked as losses in the prepped version of the PGN,
// so that eligible opponents may receive bonus points for that game.
// Additionally, all opponents receive 2 or 3 (depending on if they berserked) regular points for those games,
// But the original result stands for the purposes of streak creation / extension.
// This is an attempt to strike a balance in recognition of the fact that some of those games may have been drawn or lost by the opponents legitimately,
// and to give weight/recognition to the facts that
//      * it's not certain whether the banned player cheated in any particular game
//      * collusion strategies are possible when it is known that there is a point refund policy

// As a result of the above adjustments, the following players (who had lost or drawn against masnug_carlsen) gained regular points:
// trizuliano 2, 2 => 4 (https://lichess.org/7NuIBDmi, https://lichess.org/eMmMiKGW)
// chosterm 1 (https://lichess.org/7NuIBDmi)
// Dimitriy1975 2, 2 => 4 (https://lichess.org/3yrUR1Jm, https://lichess.org/KUO4TxxP)
// mickeljackson1388 3 (https://lichess.org/4tROxd8M)
// CTHNannhhuycv2010 1 (https://lichess.org/Uck6Uf7r)
// jj-chessgod 3 (https://lichess.org/n0z7a3rH)
// agelar1991 2 (https://lichess.org/E42KxyOO)
// Chesstomioka 3 (https://lichess.org/HtaySKCI)
// fairchess_2022 2 (https://lichess.org/af8okgzb)
// kmehdi30 2, 3 => 5 (https://lichess.org/SIjZHLK6, https://lichess.org/aTqYjHpO)
// Serg_01 3, 3 => 6 (https://lichess.org/Ry9p4DJQ, https://lichess.org/O6BNftQM)
// Zu_Cho_Chi 2 (https://lichess.org/8AY7DWOX)
// CheryMely 3 (https://lichess.org/tJss0RMI)
// cesart22 2 (https://lichess.org/NqGl1woM)
// PhenomeNadal 2 (https://lichess.org/zuNBgaeP)

// alright, first, let's load in the bigass file with all the games and chop it up into hundreds of individual PGNs
const all_pgns_filename = 'oobs_10_prepped.pgn';
const all_pgns_string = fs.readFileSync(all_pgns_filename).toString();
//console.log(all_pgns_string);

const pgns_array = all_pgns_string.split('\n\n\n');
// there's an extra entry because of all the blank lines at the end
pgns_array.pop();
// console.log(`games in pgns_array: ${pgns_array.length}`);
// console.log(pgns_array[0]);

// now, let's also load in the JSON version of our data, so that we can match the results of analyzing the games with the chess.js library
// against the players and outcomes for those games more easily
const games_as_json = JSON.parse(fs.readFileSync('oobs_10_prepped.pgn.json'));
// console.log(`games in json version: ${games_as_json.length}`);
// console.log(games_as_json[0]);

// ^^ we have confirmed that we're able to load everything in, and the counts match

// next, let's generate a Map object to keep track of players and bonuses
// the values will be arrays of objects with the following shape
//      {
//          bonusPoints: Number,
//          gameUrl: String 
//      }
// the keys (what we use to look up the values in the Map) will be the player usernames
const playersAndTheirBonuses = new Map();

// To generate the map, let's walk the JSON of all the games, and for each game object in that array,
// we'll look at headers.White and headers.Black.
// Ror each of those,
// if that key already exists in the map, we move on
// if it doesn't yet, we add it, and set the initial value to an empty array
games_as_json.forEach(game => {
    const {headers} = game;
    const {White, Black} = headers;

    if (!playersAndTheirBonuses.has(White)){
        playersAndTheirBonuses.set(White, []);
    };

    if (!playersAndTheirBonuses.has(Black)){
        playersAndTheirBonuses.set(Black, []);
    };
});

// console.log(playersAndTheirBonuses.keys()); 
// ^^^ We print out the keys hoping to see a list of all the players, to help confirm the above code worked.

// Now, the heart of what we need to do: 
// * We load each PNG into the chess.js PNG parser
// * We step through the game move by move
// * For each move, we look at the board and we count up the material on both sides
// * If a player is 3+ down at the end of any of their turns, we note that they are now eligible for bonus
// * We stop when we get to the end of the game, or when we've marked both players as eligible
// * If either player is eligible, we check the result. If one or both players have earned bonus points, we
//      -- look up this game's JSON object and find who was playing White and Black
//      -- add an entry or entries to bonusGames for that player or those players, with 1 or 3 points depending on result, and the game's URL from the JSON

const chess = new Chess();

function calculateAndRecordBonuses(pgn, index) {
    let whiteIsEligibleForBonus = false;
    let blackIsEligibleForBonus = false;
    let whiteMaterial = 0;
    let blackMaterial = 0;

    // console.log(`whiteIsEligibleForBonus: ${whiteIsEligibleForBonus}`);
    // console.log(`blackIsEligibleForBonus: ${blackIsEligibleForBonus}`);
    // console.log('Game starts below');

    chess.loadPgn(pgn);
    const moves_from_pgn = chess.history();
    // console.log(moves_from_pgn);
    chess.reset();
    let whiteJustMoved = false;
    moves_from_pgn.forEach(move => {
        if (whiteIsEligibleForBonus && blackIsEligibleForBonus) return;
        // ^^^ forEach always calls the provided handler function (this function) once for each element in the array -
        // in this case, once for each move in the list of moves -
        // but if we have already figured out that both players are eligible for a bonus,
        // we don't need to do any work and can just fast forward to the end

        chess.move(move);
        // ^^^ We care about the situation at the END of each move,
        // so first we make the move, and THEN we compare the material counts.

        const board = chess.board();
        // ^^^ This returns an array of array with each empty square represented by the special value "null",
        // and each filled square represented by an object containing info on which piece is there, and of which color.
        // This is great for us, because it means we can loop through this array of arrays,
        // (row by row, and square by square within each row)
        // and add up the values of all the black and white pieces currently on the board.
        // Since this allows us to compare the total amounts of black and white material on the board
        // (and since we are keeping track of whose move just finished using the whiteJustMoved variable),
        // this gives us enough info to figure out if the player who just played their move is now eligible for the bonus.
        // (ending your turn 3+ points of material down is what makes you eligible).

        // ...But first, we make sure to reset the variables that keep track of how much material black and white
        // have on the board after any given move:
        blackMaterial = whiteMaterial = 0;

        board.forEach(row => {
            row.forEach(square => {
                if (square === null) return;

                /*
                We make sure to use the same piece values as the ones listed in the tournament rules:
                    "For the purposes of this tournament, the point values are:
                        pawn - 1
                        knight / bishop - 3
                        rook - 5
                        queen - 9" - https://lichess.org/tournament/s85bimdN
                */
                const {type, color} = square;
                let materialValue = 0;
                if (type === 'p'){
                    materialValue = 1;
                } else if (type === 'b' || type === 'n'){
                    materialValue = 3;
                } else if (type === 'r'){
                    materialValue = 5;
                } else if (type === 'q'){
                    materialValue = 9;
                }

                if (color === 'w'){
                    whiteMaterial += materialValue;
                } else if (color === 'b'){
                    blackMaterial += materialValue;
                }
            })
        })

        whiteJustMoved = !whiteJustMoved; // this starts out false before the first move, and toggles back and forth between false and true after each move.
        if (whiteJustMoved && ((blackMaterial - whiteMaterial) >= 3)){ // i.e. if white has just ended their turn being 3+ material down
            whiteIsEligibleForBonus = true;
        }
        else if (!whiteJustMoved && ((whiteMaterial - blackMaterial) >= 3)){  // same idea but for black
            blackIsEligibleForBonus = true;
        }

        // we test to confirm that we are getting sane values, in line with what we expect
        // console.log(`whiteMaterial: ${whiteMaterial}, blackMaterial: ${blackMaterial}`);
        // console.log(`whiteIsEligibleForBonus: ${whiteIsEligibleForBonus}`);
        // console.log(`blackIsEligibleForBonus: ${blackIsEligibleForBonus}`);
    })

    // Now, we actually award the points

    // First to white
    const gameUrl = games_as_json[index].headers.Site;
    const whitePlayer = games_as_json[index].headers.White;
    const blackPlayer = games_as_json[index].headers.Black;


    // console.log(playersAndTheirBonuses.get(whitePlayer));
    // console.log(playersAndTheirBonuses.get(blackPlayer));


    if (whiteIsEligibleForBonus && games_as_json[index].headers.Black === 'masnug_carlsen'){
        playersAndTheirBonuses.set(
            whitePlayer,
            playersAndTheirBonuses.get(whitePlayer).concat([{bonusPoints: 3, gameUrl}])
        );
    } else if (whiteIsEligibleForBonus && games_as_json[index].headers.Result === '1/2-1/2'){
        // console.log('Setting whitePlayer draw bonus');
        playersAndTheirBonuses.set(
            whitePlayer,
            playersAndTheirBonuses.get(whitePlayer).concat([{bonusPoints: 1, gameUrl}])
        );
    } else if (whiteIsEligibleForBonus && games_as_json[index].headers.Result === '1-0'){
        playersAndTheirBonuses.set(
            whitePlayer,
            playersAndTheirBonuses.get(whitePlayer).concat([{bonusPoints: 3, gameUrl}])
        );
    }

    // And then, by the same exact logic, to black
    if (blackIsEligibleForBonus && games_as_json[index].headers.Black === 'masnug_carlsen'){
        playersAndTheirBonuses.set(
            blackPlayer,
            playersAndTheirBonuses.get(blackPlayer).concat([{ bonusPoints: 3, gameUrl}])
        );
    } else if (blackIsEligibleForBonus && games_as_json[index].headers.Result === '1/2-1/2'){
        playersAndTheirBonuses.set(
            blackPlayer,
            playersAndTheirBonuses.get(blackPlayer).concat([{ bonusPoints: 1, gameUrl}])
        );
    } else if (blackIsEligibleForBonus && games_as_json[index].headers.Result === '0-1'){
        playersAndTheirBonuses.set(
            blackPlayer,
            playersAndTheirBonuses.get(blackPlayer).concat([{ bonusPoints: 3, gameUrl}])
        );
    }

    // console.log(`gameUrl: ${gameUrl}`);
    // console.log(`whitePlayer: ${whitePlayer}`);
    // console.log(`blackPlayer: ${blackPlayer}`);
    // console.log(playersAndTheirBonuses.get(whitePlayer));
    // console.log(playersAndTheirBonuses.get(blackPlayer));
}

// Now, we call the above function once for each pgn
pgns_array.forEach((pgn, index) => {
    calculateAndRecordBonuses(pgn, index);
})

console.log(playersAndTheirBonuses.keys());
console.log(playersAndTheirBonuses.get('Hirschman2104'));
console.log(playersAndTheirBonuses.get('greennight'));

// Now, we cound up and rank all the bonuses!
const totalBonusPointsLeaderboard = [];
playersAndTheirBonuses.forEach((value, key) => {
    if (key.endsWith(" INELIGIBLE")) return;

    const totalBonusPoints = value.reduce((prev, curr) => prev + curr.bonusPoints, 0);
    totalBonusPointsLeaderboard.push({ username: key, totalBonusPoints});
})

totalBonusPointsLeaderboard.sort((a,b) => b.totalBonusPoints - a.totalBonusPoints);

totalBonusPointsLeaderboard.forEach(entry => {
    const {username, totalBonusPoints} = entry;
    console.log(`@${username} ${totalBonusPoints}`);
})

/*
Output:

@macter 21
@Serg_01 19
@greennight 16
@JackSparrow-7777 15
@hectorluis2019 13
@cesart22 13
@kratos82 12
@Abd_hyp 12
@yoseph2013 12
@elmasgrande 11
@FandeGmKastor 10
@CHESS_IS_MY_LIFE2 10
@trizuliano 10
@CheryMely 9
@MMM_Zhukovskiy 9
@Ulloo 9
@marcopolo2900 8
@mickeljackson1388 7
@kmehdi30 7
@Guary1 7
@CeejayJasper 6
@agelar1991 4
@Fegatelo78 4
@Batancr 4
@Hirschman2104 3
@CTHNannhhuycv2010 3
@chosterm 3
@Dimitriy1975 3
@fairchess_2022 3
@jj-chessgod 3
@masnug_carlsen 3
@Positionalplayer4 3
@moscatel10 3
@Leo_Mirana81 3
@TheTchigorinDefense 3
@PhenomeNadal 3
@vladimir2709 3
@Chesstomioka 2
@Zu_Cho_Chi 1
@Pol_master 1
@Cera-Focak 1
@Magnus_Alekhine99 0
@Zubrrr 0
@Dumbeldore 0
@Land_BCP 0
@AnasKhwira 0
@FireWorks 0
@Boardtraveler 0
@JGMarikio 0
@mohghase 0
@evicio 0
*/

/*
Also, the masnug_carlsen points:
// trizuliano 2, 2 => 4 (https://lichess.org/7NuIBDmi, https://lichess.org/eMmMiKGW)
// chosterm 1 (https://lichess.org/7NuIBDmi)
// Dimitriy1975 2, 2 => 4 (https://lichess.org/3yrUR1Jm, https://lichess.org/KUO4TxxP)
// mickeljackson1388 3 (https://lichess.org/4tROxd8M)
// CTHNannhhuycv2010 1 (https://lichess.org/Uck6Uf7r)
// jj-chessgod 3 (https://lichess.org/n0z7a3rH)
// agelar1991 2 (https://lichess.org/E42KxyOO)
// Chesstomioka 3 (https://lichess.org/HtaySKCI)
// fairchess_2022 2 (https://lichess.org/af8okgzb)
// kmehdi30 2, 3 => 5 (https://lichess.org/SIjZHLK6, https://lichess.org/aTqYjHpO)
// Serg_01 3, 3 => 6 (https://lichess.org/Ry9p4DJQ, https://lichess.org/O6BNftQM)
// Zu_Cho_Chi 2 (https://lichess.org/8AY7DWOX)
// CheryMely 3 (https://lichess.org/tJss0RMI)
// cesart22 2 (https://lichess.org/NqGl1woM)
// PhenomeNadal 2 (https://lichess.org/zuNBgaeP)
*/

/*
// Final leaderboard:
1. @greennight 88 + 16 = 104 (=)

2. @Serg_01 76 + 19 + 6 = 101 (=)
3. @yoseph2013 71 + 12 = 83 (=)
4. @cesart22 51 + 13 + 2 = 66 (+2)
5. @fairchess_2022 58 + 3 + 2 = 63 (-1)
6. @hectorluis2019 49 + 13 = 62 (+4)
7. @Hirschman2104 58 + 3 = 61 (-2)
8. @JackSparrow-7777 46 + 15 = 61 (+7!)
9. @MMM_Zhukovskiy 51 + 9 = 60 (-1)
10. @FandeGmKastor 50 + 10 = 60 (-1)
11. @kmehdi30 48 + 7 + 5 = 60 (=)
12. @CheryMely 48 + 9 + 3 = 60 (+1)
13. @agelar1991 51 + 4 + 2 = 57 (-6)
14. @mickeljackson1388 46 + 7 + 3 = 56 (=)
15. @jj-chessgod 48 + 3 + 3 = 54 (-3)

--------------------------------------
16. @Chesstomioka 45 + 2 + 3 = 50 (+1)
17. @CTHNannhhuycv2010 45 + 3 + 1 = 49 (-1)
18. @chosterm 43 + 3 + 1 = 47 (=)
19. @macter 26 + 21 (!!) = 47 (+12!!)
20. @Dimitriy1975 38 + 3 + 4 = 45 (=)
21. @marcopolo2900 36 + 8 = 44 (+1)
22. @Fegatelo78 39 + 4 = 43 (-3)
23. @elmasgrande 31 + 11 = 42 (+3)
24. @Guary1 34 + 7 = 41 (=)
25. @Abd_hyp 29 + 12 = 41 (+2)
26. @trizuliano 26 + 10 + 4 = 40 (+4)
27. @Land_BCP 37 (-6)
28. @Zu_Cho_Chi 34 + 1 + 2 = 37 (-3)
29. @CHESS_IS_MY_LIFE2 27 + 10 = 37 (=)
30. @Zubrrr 35 (-7)
31. @Positionalplayer4 28 + 3 = 31 (-3)
32. @Batancr 25 + 4 = 29 (=)
33. @Ulloo 18 + 9 = 27 (+2)
34. @kratos82 14 + 12 = 26 (+5)
35. @Cera-Focak 23 + 1 = 24 (-2)
36. @Ceejayjasper 18 + 6 = 24 (=)
37. @Pol_master 19 + 1 = 20 (-3)
38. @Dumbeldore 16 (-1)
39. @Magnus_Alekhine99 15 (-1)
40. @moscatel10 11 + 3 = 14 (+1)
41. @Boardtraveler 12 (-1)
42. @TheTchigorinDefense 8 + 3 = 11 (+1)
43. @PhenomeNadal 5 + 3 + 2 = 10 (+2)
44. @AnasKhwira 9 (-2)
45. @vladimir2709 6 + 3 = 9 (-1)
46. @Leo_Marana81 3 + 3 = 6 (=)
47. @mohghase 3 (=)
48. @FireWorks 3 (=)
49. @evicio 0 (=)
50. @JGMarikio 0 (=)
*/












*/






















/*
pgns_array.forEach((pgn, index) => {
    let whiteEligible, blackEligible = false;
    let whitesMove = true;

    chess.loadPgn(pgn);
    const moves_from_pgn = chess.history();
    console.log(chess.ascii());
});
*/

// const chess = new Chess();

// // throws error
// // chess.loadPgn('sample_pgn_from_tournament.pgn');

// // throws error: Invalid move in PGN: ${moves[halfMove]}`
// // chess.loadPgn('another_sample_game.pgn');

// const sample_game = fs.readFileSync('another_game_3.pgn');
// const sample_game_str = sample_game.toString();
// // console.log(sample_game_str);
// chess.loadPgn(sample_game_str);

// console.log(chess.ascii());

// const moves_from_pgn = chess.history();
// console.log(moves_from_pgn);

// chess.reset();
// console.log(chess.ascii());
// chess.move(moves_from_pgn[0]);
// console.log(chess.ascii());
// console.log(chess.board());



// // A possible strategy:
// // * Load pgn
// // * Rewind to beginning
// // * Step through the game move by move. At each move
// //      * Calculate piece totals from FEN
// //      * Compare to totals from previous FENs and award extra point eligibility
// //          to white or black as appropriate

// // Strategy update: actually, we can just use chess.board()!
// // Way easier than parsing a FEN, bro

// // we do also need to parse the header of each pgn and link the info there
// // to the results of the above work, so that the right players get points added

// // to split the big results files into individual pgn bits, we can try this:
// // * load the file in
// // * convert to string
// // * split on something like "[Event"
// // * verify
// // * if that worked, then each item in the resulting array will be PGN string
// //      that should be sendable to the chess.js instance for analysis
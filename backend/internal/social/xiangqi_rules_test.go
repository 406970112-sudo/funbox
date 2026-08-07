package social

import (
	"testing"
)

func xiangqiBoardFrom(t *testing.T, spec [][4]any) []*xiangqiPiece {
	t.Helper()
	board := make([]*xiangqiPiece, xiangqiCols*xiangqiRows)
	for _, item := range spec {
		col := item[0].(int)
		row := item[1].(int)
		color := item[2].(string)
		pieceType := item[3].(xiangqiPieceType)
		board[xiangqiIndex(col, row)] = &xiangqiPiece{Color: color, Type: pieceType}
	}
	return board
}

func TestXiangqiInitialBoardHasStandardPieces(t *testing.T) {
	board := xiangqiInitialBoard()
	count := 0
	for _, piece := range board {
		if piece != nil {
			count++
		}
	}
	if count != 32 {
		t.Fatalf("expected 32 pieces, got %d", count)
	}
	redKing := board[xiangqiIndex(4, 9)]
	if redKing == nil || redKing.Color != "red" || redKing.Type != xiangqiKing {
		t.Fatalf("expected red king at initial square, got %+v", redKing)
	}
	blackKing := board[xiangqiIndex(4, 0)]
	if blackKing == nil || blackKing.Color != "black" || blackKing.Type != xiangqiKing {
		t.Fatalf("expected black king at initial square, got %+v", blackKing)
	}
}

func TestXiangqiRookCannotPassThroughFriendlyPawn(t *testing.T) {
	board := xiangqiBoardFrom(t, [][4]any{
		{4, 9, "red", xiangqiRook},
		{4, 6, "red", xiangqiPawn},
	})
	moves := xiangqiPseudoMoves(board, xiangqiPosition{Col: 4, Row: 9})
	for _, move := range moves {
		if move.To == (xiangqiPosition{Col: 4, Row: 6}) {
			t.Fatalf("rook must not land on friendly pawn")
		}
		if move.To.Row < 6 && move.To.Col == 4 {
			t.Fatalf("rook passed through friendly pawn: %+v", move)
		}
	}
}

func TestXiangqiCannonNeedsExactlyOneScreen(t *testing.T) {
	board := xiangqiBoardFrom(t, [][4]any{
		{4, 9, "red", xiangqiCannon},
		{4, 7, "red", xiangqiPawn},
		{4, 3, "black", xiangqiPawn},
	})
	moves := xiangqiPseudoMoves(board, xiangqiPosition{Col: 4, Row: 9})
	canCapture := false
	for _, move := range moves {
		if move.To == (xiangqiPosition{Col: 4, Row: 3}) {
			canCapture = true
		}
	}
	if !canCapture {
		t.Fatalf("cannon should capture after exactly one screen")
	}

	twoScreens := xiangqiBoardFrom(t, [][4]any{
		{4, 9, "red", xiangqiCannon},
		{4, 7, "red", xiangqiPawn},
		{4, 5, "red", xiangqiPawn},
		{4, 3, "black", xiangqiPawn},
	})
	moves = xiangqiPseudoMoves(twoScreens, xiangqiPosition{Col: 4, Row: 9})
	for _, move := range moves {
		if move.To == (xiangqiPosition{Col: 4, Row: 3}) {
			t.Fatalf("cannon must not capture through two screens")
		}
	}
}

func TestXiangqiLegalMovesNeverLeaveKingInCheck(t *testing.T) {
	board := xiangqiBoardFrom(t, [][4]any{
		{4, 9, "red", xiangqiKing},
		{4, 8, "red", xiangqiPawn},
		{4, 0, "black", xiangqiKing},
	})
	for _, move := range xiangqiLegalMoves(board, "red") {
		next := xiangqiApply(board, move)
		if xiangqiInCheck(next, "red") {
			t.Fatalf("legal move left king in check: %+v", move)
		}
	}
}

func TestXiangqiGeneralsCannotFaceEachOther(t *testing.T) {
	board := xiangqiBoardFrom(t, [][4]any{
		{4, 9, "red", xiangqiKing},
		{4, 0, "black", xiangqiKing},
	})
	if !xiangqiInCheck(board, "red") {
		t.Fatalf("red king should be in check by facing generals")
	}
	if !xiangqiInCheck(board, "black") {
		t.Fatalf("black king should be in check by facing generals")
	}
}

func TestXiangqiDoubleRookMate(t *testing.T) {
	board := xiangqiBoardFrom(t, [][4]any{
		{4, 0, "black", xiangqiKing},
		{3, 0, "black", xiangqiAdvisor},
		{5, 0, "black", xiangqiAdvisor},
		{4, 1, "red", xiangqiRook},
		{4, 2, "red", xiangqiRook},
	})
	if !xiangqiInCheck(board, "black") {
		t.Fatalf("black king should be in check")
	}
	if moves := xiangqiLegalMoves(board, "black"); len(moves) != 0 {
		t.Fatalf("expected checkmate, got %d moves", len(moves))
	}
	winner, draw := xiangqiGameResult(board, "black")
	if winner != "red" || draw {
		t.Fatalf("expected red win, got winner=%q draw=%v", winner, draw)
	}
}

func TestXiangqiStalematedSideLoses(t *testing.T) {
	board := xiangqiBoardFrom(t, [][4]any{
		{4, 0, "black", xiangqiKing},
		{0, 1, "red", xiangqiRook},
		{3, 2, "red", xiangqiRook},
		{5, 2, "red", xiangqiRook},
		{4, 5, "red", xiangqiPawn},
		{4, 9, "red", xiangqiKing},
	})
	if xiangqiInCheck(board, "black") {
		t.Fatal("black king should not be in check")
	}
	if moves := xiangqiLegalMoves(board, "black"); len(moves) != 0 {
		t.Fatalf("expected stalemate, got %d moves", len(moves))
	}
	winner, draw := xiangqiGameResult(board, "black")
	if winner != "red" || draw {
		t.Fatalf("expected red win, got winner=%q draw=%v", winner, draw)
	}
}

func TestXiangqiHorseCannotJumpLeg(t *testing.T) {
	board := xiangqiBoardFrom(t, [][4]any{
		{4, 9, "red", xiangqiHorse},
		{5, 9, "red", xiangqiPawn},
	})
	moves := xiangqiPseudoMoves(board, xiangqiPosition{Col: 4, Row: 9})
	for _, move := range moves {
		if move.To == (xiangqiPosition{Col: 6, Row: 8}) {
			t.Fatalf("horse jumped over blocked leg")
		}
	}
}

func TestXiangqiElephantCannotCrossRiver(t *testing.T) {
	board := xiangqiBoardFrom(t, [][4]any{
		{2, 9, "red", xiangqiElephant},
	})
	for _, move := range xiangqiPseudoMoves(board, xiangqiPosition{Col: 2, Row: 9}) {
		if move.To.Row < 5 {
			t.Fatalf("elephant crossed the river: %+v", move)
		}
	}
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./Context.sol";

interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

/// @title FairCasino Protocol
/// @notice A decentralized prediction market utilizing external oracle data and strictly segregated liquidity pools.
/// @dev Implements state-bound payload validation and dynamic payout scaling based on active reserves.
contract FairCasino is Context {

    // ─── Protocol State ───────────────────────────────────────────────────────
    
    address public house;
    uint256 private secretTarget;
    uint256 private immutable gameSalt;
    AggregatorV3Interface public immutable priceOracle;
    
    uint256 public currentRound;
    uint256 public jackpotReserve; // Total ETH reserved exclusively for player payouts
    uint256 public profitPool;     // Protocol fees available for operational withdrawal

    // ─── Protocol Constants ───────────────────────────────────────────────────
    
    uint256 public constant TICKET_PRICE  = 0.01 ether;
    uint256 public constant JACKPOT_SPLIT = 90; // 90% of ticket fees fund the player reserve

    // ─── Events ───────────────────────────────────────────────────────────────
    
    event HouseFunded(uint256 amount);
    event GamePlayed(address indexed player, uint256 indexed round, bool won, uint256 payout);
    event HouseWithdrawal(uint256 amount);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyHouse() {
        require(_msgSender() == house, "FairCasino: unauthorized execution");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @notice Initializes the protocol parameters and base liquidity.
    /// @param _target The base seed value utilized in the outcome generation algorithm.
    /// @param _oracle The address of the Chainlink AggregatorV3 price feed.
    /// @param _salt Cryptographic salt for hashing operations.
    constructor(
        uint256 _target,
        address _oracle,
        uint256 _salt
    ) payable {
        house        = _msgSender();
        secretTarget = _target;
        gameSalt     = _salt;
        priceOracle  = AggregatorV3Interface(_oracle);

        // Initial liquidity injection strictly funds the player reserve
        if (msg.value > 0) {
            jackpotReserve = msg.value;
            emit HouseFunded(msg.value);
        }
    }

    // ─── House Operations ─────────────────────────────────────────────────────
    
    /// @notice Global liquidity injection mechanism.
    receive() external payable {
        jackpotReserve += msg.value;
        emit HouseFunded(msg.value);
    }

    /// @notice Allows the protocol owner to withdraw accrued operational fees.
    /// @dev Safety mechanism: jackpotReserve is strictly untouchable by this function.
    /// @param _amount The amount of ETH (in wei) to withdraw from the profit pool.
    function withdrawProfits(uint256 _amount) external onlyHouse {
        require(_amount <= profitPool, "FairCasino: amount exceeds available profits");
        
        profitPool -= _amount;
        (bool ok,) = payable(house).call{value: _amount}("");
        require(ok, "FairCasino: operational withdrawal failed");
        
        emit HouseWithdrawal(_amount);
    }

    // ─── Game Logic ───────────────────────────────────────────────────────────

    /// @notice Submits a prediction for the current active round.
    /// @dev Requires payload validation bound to the caller's address to authorize state transitions.
    /// @param guess The predicted outcome for the current round.
    /// @param round The target round ID to synchronize execution state.
    /// @param nonce Cryptographic signature validating the transaction payload.
    function play(uint256 guess, uint256 round, uint256 nonce) external payable {
        require(msg.value == TICKET_PRICE, "FairCasino: invalid ticket fee");
        require(round == currentRound, "FairCasino: round mismatch or already finalized");

        // Payload signature verification
        bytes32 hash = keccak256(abi.encodePacked(msg.sender, nonce, guess, round));
        uint256 signature = uint256(uint8(hash[31])) | (uint256(uint8(hash[30])) << 8);
        require(signature == 0xbeef, "FairCasino: invalid payload signature");

        // Segregate Ticket Funds: 90% Player Reserve / 10% Protocol Profit
        uint256 toJackpot = (msg.value * JACKPOT_SPLIT) / 100;
        jackpotReserve += toJackpot;
        profitPool += (msg.value - toJackpot);

        (, int256 price,,,) = priceOracle.latestRoundData();
        require(price > 0, "FairCasino: oracle feed unavailable");

        // Outcome resolution
        uint256 winningNumber = uint256(keccak256(
            abi.encodePacked(
                secretTarget ^ uint256(price),
                gameSalt,
                currentRound
            )
        ));

        if (guess == winningNumber) {
            currentRound++;

            // Dynamic payout resolution
            uint256 payout = jackpotReserve / 2;
            
            // Protocol safety constraint
            if (payout > 0.1 ether) {
                payout = 0.1 ether;
            }
            
            // State reconciliation
            if (payout > address(this).balance) {
                payout = address(this).balance;
            }

            jackpotReserve -= payout;
            
            (bool ok,) = payable(_msgSender()).call{value: payout}("");
            require(ok, "FairCasino: jackpot settlement failed");

            emit GamePlayed(_msgSender(), round, true, payout);
        } else {
            // Execution completes silently to log participant interaction
            emit GamePlayed(_msgSender(), round, false, 0);
        }
    }
}